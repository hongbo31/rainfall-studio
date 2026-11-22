package com.rainfallstudio.sms;

import java.io.BufferedReader;
import java.io.EOFException;
import java.io.InputStreamReader;
import java.lang.reflect.Constructor;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.UUID;

import javax.net.ssl.SSLHandshakeException;

final class InboxClientSmoke {
    public static void main(String[] args) throws Exception {
        URI endpoint = URI.create(args[0]);
        if (!"127.0.0.1".equals(endpoint.getHost())) throw new IllegalArgumentException("Loopback fixture required");

        // Production parsing accepts private network interfaces. Only this test builds a loopback address.
        Constructor<InboxAddress> constructor = InboxAddress.class.getDeclaredConstructor(
                String.class, String.class, int.class, byte[].class);
        constructor.setAccessible(true);
        byte[] pin = HexFormat.of().parseHex(endpoint.getFragment());
        byte[] wrong = pin.clone();
        wrong[0] ^= 1;
        InboxAddress wrongPin = constructor.newInstance(endpoint.toString(), endpoint.getHost(), endpoint.getPort(), wrong);
        try {
            new InboxClient(wrongPin).pair("隔离测试手机", "682149");
            throw new AssertionError("Unexpected connection with the wrong pin");
        } catch (SSLHandshakeException expected) {
            // A bad fingerprint fails before it can use the pairing code.
        }
        InboxAddress address = constructor.newInstance(endpoint.toString(), endpoint.getHost(), endpoint.getPort(), pin);
        InboxClient client = new InboxClient(address);
        String installationKey = "A".repeat(43);
        InboxClient.Pairing pairing = client.pair("隔离测试手机", "682149", installationKey);
        client.heartbeat(pairing, true);
        ReviewNotice notice = ReviewNotice.parse("【番茄音乐】您的作品《雨夜》审核通过。");
        UUID id = UUID.randomUUID();
        long receivedAt = System.currentTimeMillis();
        client.deliverArrival(pairing, id, receivedAt);
        client.deliverArrival(pairing, id, receivedAt);
        client.deliverArrival(pairing, UUID.randomUUID(), receivedAt);
        client.deliver(pairing, notice, id, receivedAt);
        client.deliver(pairing, notice, id, receivedAt);
        client.deliver(pairing, notice, UUID.randomUUID(), receivedAt);
        BufferedReader steps = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        System.out.println("DELIVERED");
        String jpeg = steps.readLine();
        if (jpeg == null) throw new EOFException("Receiver state unverified");
        var request = client.assistPoll(pairing, installationKey).getJSONObject("session");
        String sessionId = request.getString("id"), mode = request.getString("mode");
        if (!"pending".equals(request.getString("phase")) || !"rainfall".equals(mode)) {
            throw new AssertionError("Unexpected assistance request");
        }
        if (!client.assistFrame(pairing, sessionId, 1, jpeg).isNull("session")) {
            throw new AssertionError("A frame was accepted before phone approval");
        }
        var accepted = client.assistAccept(pairing, sessionId, mode).getJSONObject("session");
        if (!"active".equals(accepted.getString("phase"))) throw new AssertionError("Approval did not activate the session");
        if (!client.assistFrame(pairing, sessionId, 1, jpeg).isNull("command")) throw new AssertionError("Unexpected input");
        System.out.println("FRAMED");
        if (!"continue".equals(steps.readLine())) throw new EOFException("Viewer input unverified");
        var command = client.assistFrame(pairing, sessionId, 2, jpeg).getJSONObject("command");
        if (command.getInt("seq") != 1 || !"back".equals(command.getString("kind"))) {
            throw new AssertionError("Input did not match the approved frame");
        }
        client.assistStop(pairing, sessionId);
        if (!client.assistPoll(pairing).isNull("session")) throw new AssertionError("Phone stop did not end the session");

        client.heartbeat(pairing, false);
        client.unpair(pairing);
        try {
            client.heartbeat(pairing, true);
            throw new AssertionError("A revoked pairing was accepted");
        } catch (InboxClient.ServerError expected) {
            if (!"DEVICE_NOT_PAIRED".equals(expected.code)) throw expected;
        }
    }
}
