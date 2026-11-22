package com.rainfallstudio.sms;

import android.graphics.Bitmap;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.IOException;

final class RemoteAssistFrames {
    static final long INTERVAL_MS = 500;
    private static final int JPEG_LIMIT_BYTES = 270_000;

    private RemoteAssistFrames() {}

    static Dimensions fit(int width, int height) {
        double ratio = Math.min(1.0, Math.min(480.0 / Math.min(width, height), 960.0 / Math.max(width, height)));
        return new Dimensions(Math.max(1, (int) Math.round(width * ratio)), Math.max(1, (int) Math.round(height * ratio)));
    }

    static String jpeg(Bitmap bitmap) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 72, bytes)) throw new IOException("ASSIST_FRAME_FAILED");
        if (bytes.size() > JPEG_LIMIT_BYTES) {
            bytes.reset();
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 45, bytes) || bytes.size() > JPEG_LIMIT_BYTES) {
                throw new IOException("ASSIST_FRAME_TOO_LARGE");
            }
        }
        return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
    }

    static final class Dimensions {
        final int width;
        final int height;

        Dimensions(int width, int height) {
            this.width = width;
            this.height = height;
        }
    }
}
