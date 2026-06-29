package com.chatapp.mobile;

import android.animation.ArgbEvaluator;
import android.animation.ValueAnimator;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.webkit.JavascriptInterface;
import android.widget.ImageView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private View splashOverlay;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        addSplashOverlay();
        setupJsBridge();
        autoHideFallback();
    }

    private void addSplashOverlay() {
        // 保持导航栏与启动图片底部蓝色一致
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setNavigationBarColor(Color.parseColor("#132039"));
        }

        ImageView splash = new ImageView(this);
        splash.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        splash.setScaleType(ImageView.ScaleType.CENTER_CROP);
        splash.setImageResource(R.drawable.startimage);
        splash.setTag("splashOverlay");
        ((ViewGroup) getWindow().getDecorView()).addView(splash);
        this.splashOverlay = splash;
    }

    private void setupJsBridge() {
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void hideSplash() {
                runOnUiThread(() -> removeSplashWithFade());
            }
        }, "AndroidSplash");
    }

    private void autoHideFallback() {
        new Handler(getMainLooper()).postDelayed(this::removeSplashWithFade, 3000);
    }

    private void removeSplashWithFade() {
        if (splashOverlay == null || splashOverlay.getParent() == null) return;

        // 同步动画：浮层淡出 + 导航栏从蓝渐变到白
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            int blue = Color.parseColor("#132039");
            int white = Color.WHITE;
            ValueAnimator navAnim = ValueAnimator.ofObject(new ArgbEvaluator(), blue, white);
            navAnim.setDuration(300);
            navAnim.addUpdateListener(animator ->
                getWindow().setNavigationBarColor((int) animator.getAnimatedValue())
            );
            navAnim.start();
        }

        AlphaAnimation fadeOut = new AlphaAnimation(1f, 0f);
        fadeOut.setDuration(300);
        fadeOut.setAnimationListener(new Animation.AnimationListener() {
            @Override
            public void onAnimationStart(Animation animation) {}

            @Override
            public void onAnimationEnd(Animation animation) {
                if (splashOverlay != null) {
                    ((ViewGroup) splashOverlay.getParent()).removeView(splashOverlay);
                    splashOverlay = null;
                }
            }

            @Override
            public void onAnimationRepeat(Animation animation) {}
        });
        splashOverlay.startAnimation(fadeOut);
    }
}
