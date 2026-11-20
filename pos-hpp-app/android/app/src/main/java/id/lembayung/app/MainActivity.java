package id.lembayung.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int SYSTEM_BAR_BG = Color.parseColor("#18181B");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        // Gunakan mode edge-to-edge tunggal agar tidak terjadi double-padding
        WindowCompat.setDecorFitsSystemWindows(window, false);
        applySystemBarStyling();

        // Terapkan padding tunggal tepat sebesar tinggi status bar & navigation bar
        // dengan warna latar #18181B sehingga konsisten di Android 11 - Android 15 (HP & Tablet)
        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            contentView.setBackgroundColor(SYSTEM_BAR_BG);
            ViewCompat.setOnApplyWindowInsetsListener(contentView, (v, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(contentView);
        }

        // Tangani tombol Back pada navbar device agar kembali ke menu sebelumnya (tidak langsung keluar aplikasi)
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().evaluateJavascript(
                        "(function(){ return window.__cuaninHandleBack ? window.__cuaninHandleBack() : false; })()",
                        value -> {
                            if ("false".equals(value)) {
                                moveTaskToBack(true);
                            }
                        }
                    );
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        applySystemBarStyling();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applySystemBarStyling();
        }
    }

    private void applySystemBarStyling() {
        Window window = getWindow();
        window.setBackgroundDrawable(new ColorDrawable(SYSTEM_BAR_BG));
        window.getDecorView().setBackgroundColor(SYSTEM_BAR_BG);
        window.clearFlags(
            WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION
        );
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        window.setStatusBarColor(SYSTEM_BAR_BG);
        window.setNavigationBarColor(SYSTEM_BAR_BG);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        // Paksa ikon status bar (jam, sinyal, baterai) & tombol navigasi bawah berwarna PUTIH TERANG
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false);
            controller.setAppearanceLightNavigationBars(false);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController nativeController = window.getInsetsController();
            if (nativeController != null) {
                nativeController.setSystemBarsAppearance(
                    0,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                );
            }
        }
    }
}
