// import request from 'supertest';
// import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// import app from '#app';
// import db from '#db/client';

// beforeAll(async () -> {
//     await db.connect();
//     await db.query('BEGIN');
// });

// afterAll(async () => {
//     await db.query('ROLLBACK');
//     await db.end();
// });

// describe('POST /game-reviews', () => {
//     it('sends 400 if request body is invalid', async () => {
//         await db.query('SAVEPOINT s');
//         const response = await request(app).post('/game-reviews').send({});
//         expect(response.status).toBe(400);
//         await db.query('ROLLBACK TO s');
//     });

//     it('creates a new game review', async () => {
//         const response = (await request(app).post('/game-reviews')).send({
//             reviewTitle,
//             gameReview,
//             gameId,
//             ratingValue,
//             user_id,
//         });