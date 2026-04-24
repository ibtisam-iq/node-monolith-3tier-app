// This works with current /api/test route and avoids booting the real listener from server.js.
jest.mock('../config/db', () => ({}));

const request = require('supertest');
const app = require('../app');

describe('API health', () => {
  it('GET /api/test returns API is working', async () => {
    const res = await request(app).get('/api/test');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ message: 'API is working!' });
  });
});
