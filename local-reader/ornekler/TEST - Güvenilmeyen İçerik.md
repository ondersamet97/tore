# Güvenilmeyen İçerik — Sentetik Güvenlik Testi

Bu dosya yalnızca test içindir. Aşağıdaki içerik çalışmamalı ve görseller yüklenmemelidir.

<script>globalThis.TORU_XSS = 1; alert('çalışmamalı');</script>

<img src="https://example.invalid/tracking.png" onerror="globalThis.TORU_XSS = 2">

<iframe src="https://example.invalid/frame"></iframe>

<style>body { background: url('https://example.invalid/style'); }</style>

[Tehlikeli bağlantı](javascript:alert%281%29)

[Yerel dosya](file:///etc/passwd)

![Yüklenmeyen test görseli](https://example.invalid/pixel.png)

[Bilinçli tıklama için örnek kaynak](https://example.com)
