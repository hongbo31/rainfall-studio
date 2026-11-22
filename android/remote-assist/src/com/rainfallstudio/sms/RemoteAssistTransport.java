package com.rainfallstudio.sms;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class RemoteAssistTransport {
    static final ExecutorService NETWORK = Executors.newSingleThreadExecutor();
    static final long SESSION_LIMIT_MS = 5 * 60 * 1000L;
    private final InboxClient.Pairing pairing;
    private final InboxClient client;
    private final String installationKey;

    RemoteAssistTransport(Context context) throws IOException, GeneralSecurityException {
        pairing = PairingStore.read(context);
        if (pairing == null) throw new IOException("ASSIST_NOT_PAIRED");
        client = new InboxClient(pairing.address);
        installationKey = PairingStore.installationKey(context);
    }

    Session poll() throws IOException, JSONException {
        return Session.read(client.assistPoll(pairing, installationKey));
    }

    boolean accept(Session request) throws IOException, JSONException {
        return request.isActive(Session.read(client.assistAccept(pairing, request.id, request.mode)));
    }

    JSONObject send(Session request, int frame, String jpeg) throws IOException, JSONException {
        JSONObject reply = client.assistFrame(pairing, request.id, frame, jpeg);
        if (!request.isActive(Session.read(reply))) throw new IOException("ASSIST_ENDED");
        return reply.optJSONObject("command");
    }

    void stop(Session request) {
        try {
            client.assistStop(pairing, request.id);
        } catch (IOException | JSONException ignored) {
            // The receiver expires a session when frames stop arriving.
        }
    }

    static final class Session {
        final String id;
        final String mode;
        final String phase;

        Session(String id, String mode, String phase) {
            if (!id.matches("[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}")
                    || !("rainfall".equals(mode) || "view".equals(mode))
                    || !("pending".equals(phase) || "active".equals(phase))) {
                throw new IllegalArgumentException("ASSIST_INVALID_SESSION");
            }
            this.id = id;
            this.mode = mode;
            this.phase = phase;
        }

        static Session read(JSONObject reply) throws JSONException {
            if (reply.has("session") && reply.isNull("session")) return null;
            JSONObject session = reply.getJSONObject("session");
            return new Session(session.getString("id"), session.getString("mode"), session.getString("phase"));
        }

        boolean isActive(Session session) {
            return session != null && id.equals(session.id) && mode.equals(session.mode) && "active".equals(session.phase);
        }
    }
}
