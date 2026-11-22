package com.rainfallstudio.sms;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import static com.rainfallstudio.sms.RemoteAssistTransport.NETWORK;

public final class RemoteAssistActivity extends Activity {
    private static final int PROJECTION_REQUEST = 24;
    private static final int NOTIFICATION_REQUEST = 25;
    private static final int BACKGROUND = 0xff141323;
    private static final int TEXT = 0xfff7f2ff;
    private static final int MUTED = 0xffbab4cc;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable update = this::update;
    private LinearLayout screen;
    private TextView status;
    private Button approve;
    private Button reject;
    private Button stop;
    private FrameLayout diagnosticFrame;
    private ScrollView diagnostics;
    private boolean detail;
    private boolean resumed;
    private boolean polling;
    private volatile RemoteAssistTransport.Session control;
    private RemoteAssistTransport.Session pending;
    private RemoteAssistTransport.Session projectionRequest;
    private RemoteAssistTransport transport;
    private boolean active;
    private long localDeadline;
    private int frameSequence;
    private int lastCommandFrame;
    private long lastFrameAt;
    private long frameViewport;
    private long viewport;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        screen = new LinearLayout(this);
        screen.setBackgroundColor(BACKGROUND);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setPadding(dp(20), dp(16), dp(20), dp(16));
        if (Build.VERSION.SDK_INT >= 35) {
            screen.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(dp(20) + bars.left, dp(16) + bars.top, dp(20) + bars.right, dp(16) + bars.bottom);
                return insets;
            });
        }
        setContentView(screen);
        label(screen, "远控", 28, TEXT).setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        status = label(screen, "等待电脑发起会话", 16, MUTED);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        approve = button(screen, "允许本次会话", this::approve);
        reject = button(screen, "拒绝", () -> {
            RemoteAssistTransport.Session request = pending;
            setPending(null);
            status.setText("已拒绝");
            dispatchStop(transport, request);
        });
        stop = button(screen, "断开", () -> {
            stopService(new Intent(this, RemoteAssistProjectionService.class));
            endControl("已断开");
        });
        diagnosticFrame = new FrameLayout(this);
        diagnosticFrame.setBackgroundColor(BACKGROUND);
        diagnosticFrame.setVisibility(View.GONE);
        screen.addView(diagnosticFrame, new LinearLayout.LayoutParams(-1, 0, 1));
        diagnostics = new ScrollView(this);
        diagnostics.setFillViewport(true);
        diagnostics.setOnScrollChangeListener((view, x, y, previousX, previousY) -> viewport++);
        diagnosticFrame.addView(diagnostics, new FrameLayout.LayoutParams(-1, -1));
        diagnosticFrame.addOnLayoutChangeListener((view, l, t, r, b, prevL, prevT, prevR, prevB) -> viewport++);
        approve.setVisibility(View.GONE);
        reject.setVisibility(View.GONE);
        stop.setVisibility(View.GONE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        schedule(0);
    }

    @Override
    protected void onPause() {
        resumed = false;
        main.removeCallbacks(update);
        if (control != null) endControl("离开页面，远控已断开");
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus && control != null) endControl("窗口失去焦点，远控已断开");
    }

    private void update() {
        if (isFinishing() || !resumed) return;
        if (control != null) {
            if (active && canControl()) sendFrame();
            else if (active) endControl("远控已断开");
            return;
        }
        if (RemoteAssistProjectionService.sharing) {
            status.setText("正在共享画面 · 仅查看");
            showApproval(false);
            stop.setVisibility(View.VISIBLE);
            schedule(700);
        } else if (projectionRequest == null && !polling) {
            stop.setVisibility(View.GONE);
            poll();
        }
    }

    private void poll() {
        polling = true;
        NETWORK.execute(() -> {
            RemoteAssistTransport connection = null;
            RemoteAssistTransport.Session session = null;
            try {
                connection = new RemoteAssistTransport(getApplicationContext());
                session = connection.poll();
            } catch (Exception ignored) {
                connection = null;
            }
            RemoteAssistTransport result = connection;
            RemoteAssistTransport.Session request = session;
            main.post(() -> {
                polling = false;
                if (!resumed || isFinishing() || control != null || projectionRequest != null) return;
                transport = result;
                setPending(request != null && "pending".equals(request.phase) ? request : null);
                if (result == null) status.setText("无法连接。请检查配对、网络和电脑端接收状态");
                schedule(900);
            });
        });
    }

    private void setPending(RemoteAssistTransport.Session request) {
        pending = request;
        showApproval(request != null);
        if (request == null) status.setText("等待电脑发起会话");
        else if ("rainfall".equals(request.mode)) status.setText("电脑请求操作 Rainfall 连接诊断页");
        else status.setText(Build.VERSION.SDK_INT >= 34
                ? "电脑请求查看画面。请在下一步选「单个应用」"
                : "共享单个应用需要 Android 14 或更新版本");
        approve.setEnabled(request != null && ("rainfall".equals(request.mode) || Build.VERSION.SDK_INT >= 34));
    }

    private void showApproval(boolean show) {
        approve.setVisibility(show ? View.VISIBLE : View.GONE);
        reject.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private void approve() {
        if (!resumed || !hasWindowFocus() || pending == null || transport == null) return;
        if ("rainfall".equals(pending.mode)) {
            openControl();
        } else if (Build.VERSION.SDK_INT >= 34) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, NOTIFICATION_REQUEST);
                return;
            }
            openProjectionPicker();
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == NOTIFICATION_REQUEST && grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) {
            status.setText("请点「允许本次会话」，再选择要共享的应用");
        }
    }

    private void openProjectionPicker() {
        RemoteAssistProjectionService.createChannel(this);
        if (!RemoteAssistProjectionService.notificationsEnabled(this)) {
            status.setText("请在系统设置中开启远控状态通知");
            return;
        }
        projectionRequest = pending;
        setPending(null);
        status.setText("等待系统共享授权");
        try {
            MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
            startActivityForResult(manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForUserChoice()), PROJECTION_REQUEST);
        } catch (RuntimeException failure) {
            dispatchStop(transport, projectionRequest);
            projectionRequest = null;
            status.setText("无法打开系统共享窗口");
            schedule(900);
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code != PROJECTION_REQUEST || projectionRequest == null) return;
        RemoteAssistTransport.Session request = projectionRequest;
        projectionRequest = null;
        if (result == RESULT_OK && data != null) {
            Intent intent = new Intent(this, RemoteAssistProjectionService.class)
                    .putExtra(RemoteAssistProjectionService.SESSION, request.id)
                    .putExtra(RemoteAssistProjectionService.GRANT, data);
            try {
                startForegroundService(intent);
                status.setText("正在开启共享");
                schedule(600);
                return;
            } catch (RuntimeException ignored) {
                status.setText("无法开启共享，请重新发起会话");
            }
        } else {
            status.setText("未授权共享");
        }
        dispatchStop(transport, request);
        schedule(900);
    }

    private void openControl() {
        RemoteAssistTransport.Session request = pending;
        RemoteAssistTransport connection = transport;
        setPending(null);
        control = request;
        status.setText("正在连接诊断页");
        stop.setVisibility(View.VISIBLE);
        NETWORK.execute(() -> {
            boolean accepted;
            try {
                accepted = connection.accept(request);
            } catch (Exception failure) {
                accepted = false;
            }
            boolean result = accepted;
            main.post(() -> {
                if (control != request) return;
                if (!result || !resumed || !hasWindowFocus()) {
                    endControl("会话不可用，请在电脑重新发起");
                    return;
                }
                frameSequence = 0;
                lastCommandFrame = 0;
                lastFrameAt = 0;
                localDeadline = SystemClock.elapsedRealtime() + RemoteAssistTransport.SESSION_LIMIT_MS;
                active = true;
                status.setText("正在远控 Rainfall 连接诊断页");
                diagnosticFrame.setVisibility(View.VISIBLE);
                showDiagnostics(false);
                schedule(100);
            });
        });
    }

    private void sendFrame() {
        int width = diagnosticFrame.getWidth();
        int height = diagnosticFrame.getHeight();
        if (width == 0 || height == 0) {
            schedule(150);
            return;
        }
        RemoteAssistFrames.Dimensions size = RemoteAssistFrames.fit(width, height);
        Bitmap image = Bitmap.createBitmap(size.width, size.height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(image);
        canvas.scale((float) size.width / width, (float) size.height / height);
        diagnosticFrame.draw(canvas);
        RemoteAssistTransport.Session request = control;
        RemoteAssistTransport connection = transport;
        int sent = ++frameSequence;
        long capturedAt = SystemClock.elapsedRealtime();
        long capturedViewport = viewport;
        NETWORK.execute(() -> {
            JSONObject command = null;
            boolean success = control != request;
            try {
                if (!success) {
                    String jpeg = RemoteAssistFrames.jpeg(image);
                    if (control == request) command = connection.send(request, sent, jpeg);
                    success = true;
                }
            } catch (Exception ignored) {
                // Ending access on I/O failure also prevents controls from being retried.
            } finally {
                image.recycle();
            }
            JSONObject next = command;
            boolean delivered = success;
            main.post(() -> {
                if (control != request) return;
                if (!delivered || !canControl()) {
                    endControl("连接中断，远控已停止");
                    return;
                }
                runGesture(next, sent, width, height);
                lastFrameAt = capturedAt;
                frameViewport = capturedViewport;
                schedule(Math.max(0, capturedAt + RemoteAssistFrames.INTERVAL_MS - SystemClock.elapsedRealtime()));
            });
        });
    }

    private void runGesture(JSONObject command, int sent, int width, int height) {
        if (command == null || SystemClock.elapsedRealtime() - lastFrameAt > 1500 || frameViewport != viewport
                || width != diagnosticFrame.getWidth() || height != diagnosticFrame.getHeight()) return;
        int frame = command.optInt("seq", -1);
        if (frame != sent - 1 || frame <= lastCommandFrame) return;
        lastCommandFrame = frame;
        String kind = command.optString("kind");
        if ("back".equals(kind)) {
            if (detail) showDiagnostics(false);
            return;
        }

        double x = coordinate(command, "x");
        double y = coordinate(command, "y");
        if (Double.isNaN(x) || Double.isNaN(y)) return;
        if ("tap".equals(kind)) {
            long downAt = SystemClock.uptimeMillis();
            float pixelX = (float) (x * (width - 1));
            float pixelY = (float) (y * (height - 1));
            dispatchTouch(downAt, MotionEvent.ACTION_DOWN, pixelX, pixelY);
            dispatchTouch(downAt, MotionEvent.ACTION_UP, pixelX, pixelY);
        } else if ("swipe".equals(kind)) {
            double endX = coordinate(command, "endX");
            double endY = coordinate(command, "endY");
            if (!Double.isNaN(endX) && !Double.isNaN(endY)) {
                diagnostics.smoothScrollBy(0, (int) ((y - endY) * height));
            }
        }
    }

    private static double coordinate(JSONObject command, String key) {
        double value = command.optDouble(key, Double.NaN);
        return value >= 0 && value <= 1 ? value : Double.NaN;
    }

    private void dispatchTouch(long downAt, int action, float x, float y) {
        MotionEvent event = MotionEvent.obtain(downAt, SystemClock.uptimeMillis(), action, x, y, 0);
        try {
            diagnosticFrame.dispatchTouchEvent(event);
        } finally {
            event.recycle();
        }
    }

    private boolean canControl() {
        return resumed && hasWindowFocus() && SystemClock.elapsedRealtime() < localDeadline
                && getSystemService(PowerManager.class).isInteractive()
                && !getSystemService(KeyguardManager.class).isKeyguardLocked()
                && !PairingStore.displayName(this).isEmpty();
    }

    private void endControl(String message) {
        RemoteAssistTransport.Session request = control;
        control = null;
        active = false;
        diagnostics.removeAllViews();
        diagnosticFrame.setVisibility(View.GONE);
        stop.setVisibility(View.GONE);
        status.setText(message);
        dispatchStop(transport, request);
        schedule(950);
    }

    private static void dispatchStop(RemoteAssistTransport connection, RemoteAssistTransport.Session request) {
        if (connection != null && request != null) NETWORK.execute(() -> connection.stop(request));
    }

    private void showDiagnostics(boolean showDetail) {
        viewport++;
        detail = showDetail;
        diagnostics.removeAllViews();
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(14), dp(20), dp(14), dp(20));
        diagnostics.addView(content);
        label(content, "连接诊断", 24, TEXT).setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        if (showDetail) {
            label(content, "配对状态", 18, TEXT);
            label(content, "当前会话已通过手机确认", 15, MUTED);
            label(content, "同步状态", 18, TEXT);
            label(content, SmsSyncService.running ? "自动上报已开启" : "自动上报未开启", 15, MUTED);
            label(content, "连接范围", 18, TEXT);
            label(content, "电脑可操作当前诊断页", 15, MUTED);
            label(content, "重新连接", 18, TEXT);
            label(content, "断开后可在电脑重新发起", 15, MUTED);
            button(content, "返回", () -> showDiagnostics(false));
        } else {
            label(content, "设备已配对", 16, MUTED);
            button(content, "查看连接详情", () -> showDiagnostics(true));
        }
        diagnostics.scrollTo(0, 0);
    }

    private TextView label(LinearLayout parent, String value, int size, int color) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        text.setPadding(0, dp(7), 0, dp(7));
        parent.addView(text, new LinearLayout.LayoutParams(-1, -2));
        return text;
    }

    private Button button(LinearLayout parent, String value, Runnable action) {
        Button button = new Button(this);
        button.setText(value);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setOnClickListener(view -> action.run());
        parent.addView(button, new LinearLayout.LayoutParams(-1, -2));
        return button;
    }

    private void schedule(long delay) {
        main.removeCallbacks(update);
        if (resumed) main.postDelayed(update, delay);
    }

    private int dp(int units) {
        return Math.round(units * getResources().getDisplayMetrics().density);
    }
}
