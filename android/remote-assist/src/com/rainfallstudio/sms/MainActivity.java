package com.rainfallstudio.sms;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputFilter;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONException;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.net.ssl.SSLHandshakeException;

public final class MainActivity extends Activity {
    private static final int REQUEST_MONITORING = 19;
    private static final int PAGE_COLOR = 0xff141323;
    private static final int MUTED = 0xffbab4cc;
    private static final AtomicBoolean PAIRING_WORK = new AtomicBoolean();
    private static volatile String operationStatus = "";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable refreshLoop = new Runnable() {
        @Override
        public void run() {
            refresh();
            main.postDelayed(this, 750);
        }
    };
    private FrameLayout screen;
    private LinearLayout content;
    private TextView status;
    private Button pairButton;
    private Button startButton;
    private Button unlinkButton;
    private boolean showingPaired;

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstance) {
        super.onCreate(savedInstance);
        screen = new FrameLayout(this);
        screen.setBackgroundColor(PAGE_COLOR);
        if (Build.VERSION.SDK_INT >= 30) {
            screen.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return insets;
            });
            if (Build.VERSION.SDK_INT < 35) getWindow().setDecorFitsSystemWindows(false);
        }
        setContentView(screen);
        render(PairingStore.displayName(this));
    }

    @Override
    protected void onStart() {
        super.onStart();
        main.post(refreshLoop);
    }

    @Override
    protected void onStop() {
        main.removeCallbacks(refreshLoop);
        super.onStop();
    }

    private void render(String phoneName) {
        showingPaired = !phoneName.isEmpty();
        screen.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(28), dp(24), dp(32));
        scroll.addView(content);
        screen.addView(scroll);

        TextView brand = text("RAINFALL STUDIO", 12, 0xffd2bfff, 0);
        brand.setLetterSpacing(0.12f);
        text("短信接收", 29, 0xfff7f2ff, 6).setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        status = text("", 15, MUTED, 10);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);

        if (showingPaired) {
            text(phoneName, 20, 0xfff7f2ff, 28).setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            startButton = button("开启自动上报", 12, view -> toggleMonitoring());
            button("远控", 4, view -> startActivity(new Intent(this, RemoteAssistActivity.class)));
            unlinkButton = button("解除配对", 4, view -> unlink());
            button("应用权限设置", 4, view -> openPermissionSettings());
        } else {
            EditText address = input("电脑端配对地址", "粘贴 Rainfall 显示的地址", "", 130,
                    InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI, 24);
            String model = Build.MODEL.trim();
            EditText name = input("手机名称", "电脑端显示的设备名称", model.length() <= 48 ? model : "", 48,
                    InputType.TYPE_CLASS_TEXT, 14);
            EditText code = input("6 位数字口令", "与电脑端口令相同", "", 6,
                    InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD, 14);
            pairButton = button("配对", 14, view -> link(address, name, code));
        }

        refresh();
    }

    private void refresh() {
        String phoneName = PairingStore.displayName(this);
        if (showingPaired != !phoneName.isEmpty()) {
            render(phoneName);
            return;
        }
        boolean busy = PAIRING_WORK.get();
        String message;
        if (busy) {
            message = showingPaired ? "正在解除配对" : "正在配对";
        } else if (SmsSyncService.running) {
            message = SmsSyncService.status;
        } else if (!operationStatus.isEmpty()) {
            message = operationStatus;
        } else if (showingPaired) {
            message = "已配对 · " + SmsSyncService.status;
        } else {
            message = SmsSyncService.status.equals("电脑已取消配对") ? SmsSyncService.status : "等待配对";
        }
        if (!message.contentEquals(status.getText())) status.setText(message);
        if (showingPaired) {
            startButton.setText(SmsSyncService.running ? "停止同步" : "开启自动上报");
            startButton.setEnabled(!busy);
            unlinkButton.setEnabled(!busy);
        } else {
            pairButton.setEnabled(!busy);
        }
    }

    private void link(EditText addressInput, EditText nameInput, EditText codeInput) {
        InboxAddress address;
        try {
            address = InboxAddress.parse(addressInput.getText().toString());
        } catch (IllegalArgumentException invalid) {
            updateStatus("请完整粘贴电脑端显示的配对地址");
            return;
        }
        String name = nameInput.getText().toString().trim();
        String code = codeInput.getText().toString();
        if (name.length() > 48 || !name.matches("[\\p{L}\\p{M}\\p{N} .。_()（）·・—！!，,、？?＆&+'’-]+")) {
            updateStatus("手机名称须在 48 字内，可使用文字、数字及常用标点");
            return;
        }
        if (!code.matches("[0-9]{6}")) {
            updateStatus("请输入电脑端设置的 6 位数字口令");
            return;
        }
        if (!PAIRING_WORK.compareAndSet(false, true)) return;
        codeInput.setText("");
        hideKeyboard(codeInput);
        refresh();
        Context context = getApplicationContext();
        SmsSyncService.NETWORK.execute(() -> {
            try {
                InboxClient client = new InboxClient(address);
                InboxClient.Pairing pairing = client.pair(name, code, PairingStore.installationKey(context));
                try {
                    PairingStore.save(context, pairing);
                } catch (GeneralSecurityException | IOException | RuntimeException failure) {
                    PairingStore.clear(context);
                    try {
                        client.unpair(pairing);
                    } catch (IOException | JSONException ignored) {
                        // Desktop can remove an orphaned registration if connectivity was lost.
                    }
                    throw new GeneralSecurityException("PAIRING_NOT_SAVED", failure);
                }
                try {
                    client.heartbeat(pairing, false);
                } catch (IOException | JSONException ignored) {
                    // The saved pairing can connect when the receiver becomes reachable again.
                }
                SmsSyncService.status = "已暂停";
                operationStatus = "已配对 · 可以开启自动上报";
            } catch (InboxClient.ServerError error) {
                operationStatus = "PAIR_CODE_REJECTED".equals(error.code) || error.status == 409 || error.status == 429
                        ? "口令无效或已过期，请在电脑重新创建口令"
                        : "配对未完成，请核对电脑端接收状态";
            } catch (SSLHandshakeException error) {
                operationStatus = "无法验证电脑证书，请重新复制配对地址";
            } catch (GeneralSecurityException error) {
                operationStatus = "无法在手机保存配对，请检查系统后重试";
            } catch (IOException | JSONException | RuntimeException error) {
                operationStatus = "无法连接电脑，请核对配对地址和网络";
            } finally {
                PAIRING_WORK.set(false);
            }
        });
    }

    private void unlink() {
        if (!PAIRING_WORK.compareAndSet(false, true)) return;
        stopService(new Intent(this, SmsSyncService.class));
        refresh();
        Context context = getApplicationContext();
        SmsSyncService.NETWORK.execute(() -> {
            try {
                InboxClient.Pairing pairing = PairingStore.read(context);
                if (pairing != null) new InboxClient(pairing.address).unpair(pairing);
                operationStatus = "已解除配对";
            } catch (InboxClient.ServerError error) {
                operationStatus = error.status == 401 ? "已解除配对" : "手机已解绑，请在电脑移除旧设备";
            } catch (GeneralSecurityException | IOException | JSONException | RuntimeException error) {
                operationStatus = "手机已解绑，请在电脑移除旧设备";
            } finally {
                PairingStore.clear(context);
                PAIRING_WORK.set(false);
            }
        });
    }

    private void toggleMonitoring() {
        updateStatus("");
        if (SmsSyncService.running) {
            stopService(new Intent(this, SmsSyncService.class));
            return;
        }
        ArrayList<String> permissions = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.RECEIVE_SMS);
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (permissions.isEmpty()) startMonitoring();
        else requestPermissions(permissions.toArray(new String[0]), REQUEST_MONITORING);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_MONITORING && !PAIRING_WORK.get() && !PairingStore.displayName(this).isEmpty()) {
            startMonitoring();
        }
    }

    private void startMonitoring() {
        SmsSyncService.createChannel(this);
        if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
            updateStatus("系统未授权接收短信，请核对应用权限设置");
            return;
        }
        if (!SmsSyncService.notificationsEnabled(this)) {
            updateStatus("请在应用权限设置开启状态通知");
            return;
        }
        try {
            startForegroundService(new Intent(this, SmsSyncService.class));
        } catch (IllegalStateException | SecurityException error) {
            updateStatus("无法开启同步，请核对系统权限后重试");
        }
    }

    private void openPermissionSettings() {
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getPackageName(), null)));
    }

    private void updateStatus(String message) {
        operationStatus = message;
        refresh();
    }

    private TextView text(String value, int size, int color, int margin) {
        TextView label = new TextView(this);
        label.setText(value);
        label.setTextSize(size);
        label.setTextColor(color);
        add(label, margin);
        return label;
    }

    private EditText input(String label, String hint, String value, int length, int inputType, int margin) {
        TextView caption = text(label, 14, MUTED, margin);
        EditText field = new EditText(this);
        field.setId(View.generateViewId());
        caption.setLabelFor(field.getId());
        field.setSingleLine(true);
        field.setInputType(inputType);
        field.setImeOptions(EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        field.setFilters(new InputFilter[] { new InputFilter.LengthFilter(length) });
        field.setHint(hint);
        field.setText(value);
        field.setMinHeight(dp(48));
        add(field, 0);
        return field;
    }

    private Button button(String label, int margin, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setOnClickListener(listener);
        add(button, margin);
        return button;
    }

    private void add(View view, int margin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(margin);
        content.addView(view, params);
    }

    private void hideKeyboard(View view) {
        getSystemService(InputMethodManager.class).hideSoftInputFromWindow(view.getWindowToken(), 0);
        view.clearFocus();
    }

    private int dp(int size) {
        return Math.round(size * getResources().getDisplayMetrics().density);
    }
}
