import { describe, it, expect } from 'vitest';
import { minuteOptionsFor, QUARTER_MINUTES } from './QuarterTimeSelect.jsx';

describe('minuteOptionsFor', () => {
    it('15分刻みの値だけなら4択のまま', () => {
        expect(minuteOptionsFor('15', '')).toEqual(QUARTER_MINUTES);
    });

    it('半端な現在値を選択肢に残す', () => {
        expect(minuteOptionsFor('07', '')).toEqual(['00', '07', '15', '30', '45']);
    });

    it('別の分に変えた後も初期値の半端な分を残す', () => {
        expect(minuteOptionsFor('30', '07')).toEqual(['00', '07', '15', '30', '45']);
    });

    it('現在値と初期値が同じ半端な分でも重複させない', () => {
        expect(minuteOptionsFor('07', '07')).toEqual(['00', '07', '15', '30', '45']);
    });
});
