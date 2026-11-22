import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import com.android.apksig.KeyConfig;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public final class SignApk {
    public static void main(String[] args) throws Exception {
        char[] password = System.getenv("RAINFALL_SMS_SIGNING_PASSWORD").toCharArray();
        File unsigned = new File(args[0]);
        File signed = new File(args[1]);
        KeyStore local = KeyStore.getInstance("PKCS12");
        try (InputStream input = Files.newInputStream(Path.of(args[2]))) {
            local.load(input, password);
        }
        PrivateKey privateKey = (PrivateKey) local.getKey("rainfall-sms", password);
        Arrays.fill(password, '\0');
        X509Certificate certificate = (X509Certificate) local.getCertificate("rainfall-sms");
        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("rainfall-sms", new KeyConfig.Jca(privateKey),
                Collections.singletonList(certificate)).build();
        new ApkSigner.Builder(Collections.singletonList(signer)).setInputApk(unsigned).setOutputApk(signed)
                .setMinSdkVersion(26).setV1SigningEnabled(false).setV2SigningEnabled(true)
                .setV3SigningEnabled(true).setV4SigningEnabled(false).build().sign();
        ApkVerifier.Result verification = new ApkVerifier.Builder(signed).build().verify();
        if (!verification.isVerified() || !verification.isVerifiedUsingV2Scheme() || !verification.isVerifiedUsingV3Scheme()
                || !verification.getSignerCertificates().equals(List.of(certificate))) {
            throw new IllegalStateException("APK signature check failed: " + verification.getAllErrors());
        }
        try (ZipFile apk = new ZipFile(signed)) {
            ZipEntry resources = apk.getEntry("resources.arsc");
            ZipEntry dex = apk.getEntry("classes.dex");
            if (apk.getEntry("AndroidManifest.xml") == null || resources == null
                    || resources.getMethod() != ZipEntry.STORED || dex == null || dex.getSize() == 0) {
                throw new IllegalStateException("APK content check failed");
            }
        }
        System.out.println("APK verified using signature schemes v2 and v3");
    }
}
