import { describe, it, expect } from 'vitest';
import { parseUserAgent } from './userAgent';

describe('parseUserAgent', () => {
    it('Windows の Chrome', () => {
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
        expect(parseUserAgent(ua)).toEqual({ os: 'Windows', browser: 'Chrome' });
    });

    it('Windows の Edge は Chrome と判定しない', () => {
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0';
        expect(parseUserAgent(ua)).toEqual({ os: 'Windows', browser: 'Edge' });
    });

    it('macOS の Safari', () => {
        const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
        expect(parseUserAgent(ua)).toEqual({ os: 'macOS', browser: 'Safari' });
    });

    it('iPhone の Safari / Chrome / Firefox', () => {
        const base = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
        expect(parseUserAgent(`${base} Version/17.5 Mobile/15E148 Safari/604.1`)).toEqual({ os: 'iOS (iPhone)', browser: 'Safari' });
        expect(parseUserAgent(`${base} CriOS/129.0.0.0 Mobile/15E148 Safari/604.1`)).toEqual({ os: 'iOS (iPhone)', browser: 'Chrome' });
        expect(parseUserAgent(`${base} FxiOS/130.0 Mobile/15E148 Safari/605.1.15`)).toEqual({ os: 'iOS (iPhone)', browser: 'Firefox' });
    });

    it('Android の Chrome と Samsung Internet', () => {
        expect(parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'))
            .toEqual({ os: 'Android', browser: 'Chrome' });
        expect(parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36'))
            .toEqual({ os: 'Android', browser: 'Samsung Internet' });
    });

    it('Linux の Firefox', () => {
        const ua = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
        expect(parseUserAgent(ua)).toEqual({ os: 'Linux', browser: 'Firefox' });
    });

    it('空・不明な値は「不明」', () => {
        expect(parseUserAgent(null)).toEqual({ os: '不明', browser: '不明' });
        expect(parseUserAgent('')).toEqual({ os: '不明', browser: '不明' });
        expect(parseUserAgent('curl/8.4.0')).toEqual({ os: '不明', browser: '不明' });
    });
});
