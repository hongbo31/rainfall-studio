package com.rainfallstudio.sms;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class InboxAddress {
    private static final Pattern FORMAT = Pattern.compile(
            "\\Ahttps://((?:[0-9]{1,3}\\.){3}[0-9]{1,3}):([1-9][0-9]{0,4})/#([0-9a-f]{64})\\z");

    final String text;
    final String host;
    final int port;
    final byte[] fingerprint;

    private InboxAddress(String text, String host, int port, byte[] fingerprint) {
        this.text = text;
        this.host = host;
        this.port = port;
        this.fingerprint = fingerprint;
    }

    static InboxAddress parse(String text) {
        Matcher address = FORMAT.matcher(text.trim());
        if (!address.matches()) throw new IllegalArgumentException("INVALID_ADDRESS");
        String host = address.group(1);
        String[] parts = host.split("\\.");
        int[] octets = new int[parts.length];
        for (int index = 0; index < parts.length; index++) {
            octets[index] = Integer.parseInt(parts[index]);
            if (octets[index] > 255 || !parts[index].equals(Integer.toString(octets[index]))) {
                throw new IllegalArgumentException("INVALID_ADDRESS");
            }
        }
        int first = octets[0];
        int second = octets[1];
        boolean privateAddress = first == 10 || first == 172 && second >= 16 && second <= 31
                || first == 192 && second == 168 || first == 100 && second >= 64 && second <= 127;
        int port = Integer.parseInt(address.group(2));
        if (!privateAddress || port > 65535) throw new IllegalArgumentException("INVALID_ADDRESS");

        String hex = address.group(3);
        byte[] fingerprint = new byte[32];
        for (int index = 0; index < fingerprint.length; index++) {
            fingerprint[index] = (byte) Integer.parseInt(hex.substring(index * 2, index * 2 + 2), 16);
        }
        return new InboxAddress(address.group(), host, port, fingerprint);
    }
}
