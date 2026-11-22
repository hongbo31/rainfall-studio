package com.rainfallstudio.sms;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PairingStore {
    private static final String PREFERENCES = "rainfall_sms_pairing";
    private static final String INSTALLATION_PREFERENCES = "rainfall_sms_installation";
    private static final String INSTALLATION_KEY = "installationKey";
    private static final String KEY_ALIAS = "rainfall_sms_credential";
    private static final int IV_SIZE = 12;

    private PairingStore() {}

    static String displayName(Context context) {
        return preferences(context).getString("name", "");
    }

    static synchronized String installationKey(Context context) throws IOException {
        SharedPreferences values = context.getSharedPreferences(INSTALLATION_PREFERENCES, Context.MODE_PRIVATE);
        String existing = values.getString(INSTALLATION_KEY, null);
        if (existing != null) {
            if (!existing.matches("[A-Za-z0-9_-]{43}")) throw new IOException("INVALID_INSTALLATION_KEY");
            return existing;
        }
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        String generated = Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
        if (!values.edit().putString(INSTALLATION_KEY, generated).commit()) {
            throw new IOException("INSTALLATION_KEY_NOT_SAVED");
        }
        return generated;
    }

    static InboxClient.Pairing read(Context context) throws GeneralSecurityException, IOException {
        SharedPreferences values = preferences(context);
        String protectedToken = values.getString("credential", "");
        if (protectedToken.isEmpty()) return null;
        byte[] data = Base64.decode(protectedToken, Base64.NO_WRAP);
        if (data.length != IV_SIZE + 43 + 16) throw new GeneralSecurityException("INVALID_CREDENTIAL");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, data, 0, IV_SIZE));
        String token = new String(cipher.doFinal(data, IV_SIZE, data.length - IV_SIZE), StandardCharsets.US_ASCII);
        return new InboxClient.Pairing(InboxAddress.parse(values.getString("address", "")),
                values.getString("name", ""), values.getString("deviceId", ""), token);
    }

    static void save(Context context, InboxClient.Pairing pairing) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        byte[] iv = cipher.getIV();
        if (iv.length != IV_SIZE) throw new GeneralSecurityException("INVALID_IV");
        byte[] encrypted = cipher.doFinal(pairing.token.getBytes(StandardCharsets.US_ASCII));
        byte[] data = Arrays.copyOf(iv, iv.length + encrypted.length);
        System.arraycopy(encrypted, 0, data, iv.length, encrypted.length);
        if (!preferences(context).edit().clear().putString("address", pairing.address.text)
                .putString("name", pairing.name).putString("deviceId", pairing.deviceId)
                .putString("credential", Base64.encodeToString(data, Base64.NO_WRAP)).commit()) {
            throw new IOException("PAIRING_NOT_SAVED");
        }
    }

    static synchronized void clear(Context context) {
        preferences(context).edit().clear().commit();
    }

    static synchronized String readQueue(Context context, String deviceId, String queueKey) {
        SharedPreferences values = preferences(context);
        if (!deviceId.equals(values.getString("deviceId", ""))) return "[]";
        return values.getString(queueKey, "[]");
    }

    static synchronized void saveQueue(Context context, String deviceId, String queueKey, String entries) throws IOException {
        SharedPreferences values = preferences(context);
        if (!deviceId.equals(values.getString("deviceId", ""))
                || !values.edit().putString(queueKey, entries).commit()) {
            throw new IOException("QUEUE_NOT_SAVED");
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static SecretKey key(boolean create) throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey existing = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;
        if (!create) throw new GeneralSecurityException("CREDENTIAL_KEY_MISSING");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
}
