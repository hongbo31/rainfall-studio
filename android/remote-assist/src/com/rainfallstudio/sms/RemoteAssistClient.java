package com.rainfallstudio.sms;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.UUID;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLPeerUnverifiedException;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

final class InboxClient {
    private static final int MAX_REPLY_BYTES = 4096;
    private final InboxAddress address;
    private final SSLSocketFactory sockets;

    InboxClient(InboxAddress address) throws GeneralSecurityException {
        this.address = address;
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[] { new PinnedTrust() }, null);
        sockets = context.getSocketFactory();
    }

    Pairing pair(String name, String code) throws IOException, JSONException {
        return pair(name, code, null);
    }

    Pairing pair(String name, String code, String installationKey) throws IOException, JSONException {
        JSONObject reply = postWithInstallation("/v1/pair", null, new JSONObject().put("name", name).put("code", code),
                installationKey);
        return new Pairing(address, name, reply.getString("deviceId"), reply.getString("token"));
    }

    void heartbeat(Pairing pairing, boolean listening) throws IOException, JSONException {
        post("/v1/heartbeat", pairing, new JSONObject().put("listening", listening));
    }

    void deliver(Pairing pairing, ReviewNotice notice, UUID deliveryId, long receivedAt)
            throws IOException, JSONException {
        post("/v1/notices", pairing, new JSONObject()
                .put("id", deliveryId.toString()).put("receivedAt", receivedAt)
                .put("platform", notice.platform).put("status", notice.status).put("title", notice.title));
    }

    void deliverArrival(Pairing pairing, UUID arrivalId, long receivedAt) throws IOException, JSONException {
        post("/v1/arrivals", pairing, new JSONObject().put("id", arrivalId.toString()).put("receivedAt", receivedAt));
    }

    void unpair(Pairing pairing) throws IOException, JSONException {
        post("/v1/unpair", pairing, new JSONObject());
    }

    JSONObject assistPoll(Pairing pairing) throws IOException, JSONException {
        return assistPoll(pairing, null);
    }

    JSONObject assistPoll(Pairing pairing, String installationKey) throws IOException, JSONException {
        return postWithInstallation("/v1/assist/poll", pairing, new JSONObject(), installationKey);
    }

    JSONObject assistAccept(Pairing pairing, String id, String mode) throws IOException, JSONException {
        return post("/v1/assist/accept", pairing, new JSONObject().put("id", id).put("mode", mode));
    }

    JSONObject assistFrame(Pairing pairing, String id, int seq, String jpeg) throws IOException, JSONException {
        return post("/v1/assist/frame", pairing, new JSONObject().put("id", id).put("seq", seq).put("jpeg", jpeg));
    }

    void assistStop(Pairing pairing, String id) throws IOException, JSONException {
        post("/v1/assist/stop", pairing, new JSONObject().put("id", id));
    }

    private JSONObject postWithInstallation(String route, Pairing pairing, JSONObject body, String installationKey)
            throws IOException, JSONException {
        if (installationKey == null) return post(route, pairing, body);
        body.put("installationKey", installationKey);
        try {
            return post(route, pairing, body);
        } catch (ServerError error) {
            // Older desktops reject the extra field during schema validation, before processing the request.
            if (error.status != 400 || !"INVALID_REQUEST".equals(error.code)) throw error;
            body.remove("installationKey");
            return post(route, pairing, body);
        }
    }

    private JSONObject post(String route, Pairing pairing, JSONObject body) throws IOException, JSONException {
        HttpsURLConnection connection = (HttpsURLConnection) new URL("https", address.host, address.port, route)
                .openConnection(Proxy.NO_PROXY);
        connection.setSSLSocketFactory(sockets);
        // The copied address identifies the peer by its certificate pin, including when its local IP changes.
        connection.setHostnameVerifier((host, session) -> {
            if (!address.host.equals(host)) return false;
            try {
                Certificate[] certificates = session.getPeerCertificates();
                return certificates.length > 0 && certificates[0] instanceof X509Certificate
                        && matchesPin((X509Certificate) certificates[0]);
            } catch (SSLPeerUnverifiedException invalid) {
                return false;
            }
        });
        connection.setRequestMethod("POST");
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setConnectTimeout(4500);
        connection.setReadTimeout(5000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        if (pairing != null) connection.setRequestProperty("Authorization", "Bearer " + pairing.token);

        byte[] request = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(request.length);
        try {
            try (OutputStream output = connection.getOutputStream()) {
                output.write(request);
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                String code = errorCode(connection.getErrorStream());
                // Some HttpsURLConnection implementations omit the 401 body in streaming mode.
                if (status == 401 && "REQUEST_FAILED".equals(code)) {
                    code = pairing == null ? "PAIR_CODE_REJECTED" : "DEVICE_NOT_PAIRED";
                }
                throw new ServerError(status, code);
            }
            JSONObject reply = new JSONObject(readReply(connection.getInputStream()));
            if (!reply.optBoolean("ok")) throw new IOException("INVALID_REPLY");
            return reply;
        } finally {
            connection.disconnect();
        }
    }

    private static String errorCode(InputStream errorStream) throws IOException {
        if (errorStream != null) {
            try {
                String code = new JSONObject(readReply(errorStream)).optString("code");
                if (code.matches("[A-Z][A-Z0-9_]{0,47}")) return code;
            } catch (JSONException ignored) {
                // Display only the local generic error when the server has no recognized error code.
            }
        }
        return "REQUEST_FAILED";
    }

    private static String readReply(InputStream input) throws IOException {
        try (InputStream reply = input) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int length;
            while ((length = reply.read(buffer)) != -1) {
                if (bytes.size() + length > MAX_REPLY_BYTES) throw new IOException("REPLY_TOO_LARGE");
                bytes.write(buffer, 0, length);
            }
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private boolean matchesPin(X509Certificate certificate) {
        try {
            certificate.checkValidity();
            byte[] fingerprint = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
            return MessageDigest.isEqual(address.fingerprint, fingerprint);
        } catch (GeneralSecurityException invalid) {
            return false;
        }
    }

    private final class PinnedTrust implements X509TrustManager {
        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authentication) throws CertificateException {
            if (chain == null || chain.length == 0 || !matchesPin(chain[0])) {
                throw new CertificateException("PIN_MISMATCH");
            }
        }

        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authentication) throws CertificateException {
            throw new CertificateException("CLIENT_CERTIFICATE_UNEXPECTED");
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }

    static final class Pairing {
        final InboxAddress address;
        final String name;
        final String deviceId;
        final String token;

        Pairing(InboxAddress address, String name, String deviceId, String token) {
            if (!deviceId.matches("[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}")
                    || !token.matches("[a-zA-Z0-9_-]{43}")) {
                throw new IllegalArgumentException("INVALID_PAIRING_REPLY");
            }
            this.address = address;
            this.name = name;
            this.deviceId = deviceId;
            this.token = token;
        }
    }

    static final class ServerError extends IOException {
        final int status;
        final String code;

        ServerError(int status, String code) {
            super("INBOX_REQUEST_FAILED");
            this.status = status;
            this.code = code;
        }
    }
}
