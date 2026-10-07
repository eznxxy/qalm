import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns the documented envelope { data: { status: "ok" } }', () => {
    const controller = new HealthController();
    expect(controller.getHealth()).toEqual({ data: { status: 'ok' } });
    expect(Object.keys(controller.getHealth())).toEqual(['data']);
    expect(Object.keys(controller.getHealth()['data'])).toEqual(['status']);
  });
});
