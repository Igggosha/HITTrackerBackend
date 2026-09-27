import { routeLabel } from './metrics.interceptor';

describe('routeLabel', () => {
  it('uses the Nest route template and never a concrete request URL', () => {
    expect(
      routeLabel({
        baseUrl: '/workouts',
        route: { path: '/history/:id' },
      }),
    ).toBe('/workouts/history/:id');
  });

  it('omits unmatched requests without a route template', () => {
    expect(routeLabel({ baseUrl: '/users' })).toBeUndefined();
  });
});
