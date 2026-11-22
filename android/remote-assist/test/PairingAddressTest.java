package com.rainfallstudio.sms;

import java.util.Arrays;
import java.util.List;

public final class ReviewNoticeTest {
    public static void main(String[] args) {
        matches("【番茄音乐】您的作品《雨夜》审核通过。", "fanqie", "approved", "雨夜");
        matches("【汽水音乐】您的歌曲《凌晨三点》未通过审核。", "qishui", "rejected", "凌晨三点");
        matches("【网易云音乐】作品《远方》进入审核。", "netease", "reviewing", "远方");
        matches("【QQ 音乐】您的作品《Blue Moon (Demo)》已通过审核！", "qq", "approved", "Blue Moon (Demo)");
        matches("【酷狗音乐】作品《海风》审核中", "kugou", "reviewing", "海风");
        matches("【腾讯音乐发行】您的歌曲《风声》审核未通过。", "tme", "rejected", "风声");
        for (String unknown : List.of(
                "今晚早点回来，晚饭留在桌上。",
                "您的作品《雨夜》审核通过。",
                "【番茄音乐】验证码 371238，用于登录。",
                "【汽水音乐】您的作品《登录验证码》审核通过。",
                "【番茄音乐】您的作品《123456》审核通过。",
                "【汽水音乐】您的作品《雨夜１２３４５６》审核通过。",
                "【汽水音乐】您的作品《Reset password》审核通过。",
                "【番茄音乐】您的作品《lake https://example.com》审核通过。",
                "【番茄音乐】作品《rain.example.com》审核通过。",
                "【番茄音乐】您的作品《雨夜》审核通过。前往 https://example.com 查看",
                "认证消息：【番茄音乐】您的作品《雨夜》审核通过。",
                "【番茄音乐】您的作品《雨夜》审核通过。\n其他消息",
                "【番茄音乐】您的作品《雨\u200b夜》审核通过。",
                "【未知平台】您的作品《雨夜》审核通过。",
                "【番茄音乐】您的作品《" + "雨".repeat(81) + "》审核通过。")) {
            if (ReviewNotice.parse(unknown) != null) {
                throw new AssertionError("A rejected fixture was recognized");
            }
        }
        String fingerprint = "a".repeat(64);
        InboxAddress address = InboxAddress.parse("https://192.168.1.30:8787/#" + fingerprint);
        if (!address.host.equals("192.168.1.30") || address.port != 8787 || address.fingerprint.length != 32) {
            throw new AssertionError("Pairing address did not retain its host, port and pin");
        }
        InboxAddress vpn = InboxAddress.parse("https://100.96.20.4:8787/#" + fingerprint);
        if (!vpn.host.equals("100.96.20.4") || !Arrays.equals(vpn.fingerprint, address.fingerprint)) {
            throw new AssertionError("Private VPN address did not retain its host and pin");
        }
        for (String invalid : List.of(
                "http://192.168.1.30:8787/#" + fingerprint,
                "https://192.168.1.30:8787/",
                "https://192.168.1.30:8787/#abc",
                "https://192.168.1.30:8787/foo/#" + fingerprint,
                "https://192.168.1.30:8787/?x=1#" + fingerprint,
                "https://192.168.1.30:99999/#" + fingerprint,
                "https://192.168.001.30:8787/#" + fingerprint,
                "https://192.168.1.300:8787/#" + fingerprint,
                "https://100.128.20.4:8787/#" + fingerprint,
                "https://8.8.8.8:8787/#" + fingerprint)) {
            try {
                InboxAddress.parse(invalid);
                throw new AssertionError("An invalid pairing address was accepted");
            } catch (IllegalArgumentException expected) {
                // A rejected address never starts a connection.
            }
        }
        System.out.println("Review notice and pairing address tests passed");
    }

    private static void matches(String text, String platform, String status, String title) {
        ReviewNotice notice = ReviewNotice.parse(text);
        if (notice == null || !platform.equals(notice.platform) || !status.equals(notice.status)
                || !title.equals(notice.title)) {
            throw new AssertionError("A supported review notice did not produce the expected fields");
        }
    }
}
