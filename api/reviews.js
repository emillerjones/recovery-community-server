import express from 'express';
import requireBody from '#middleware/requireBody';
import requireUser from '#middleware/requireUser';
import { createToken } from '#utils/jwt';

import { 
    createGameReviews, 
    getGameReviews, 
    getGameReviewByGameId, 
    getGameReviewById, 
    getMyReview,
    incrementGameReviewViewCount,
    deleteGameReviewById,
    updateGameReviewById,
    getReviewVotes,
    upsertReviewVote,
    deleteReviewVote
    } from '#db/queries/reviews';

const gameReviewsRouter= express.Router();
export default gameReviewsRouter;

/* ====== Game Reviews ====== */

gameReviewsRouter.param('id', async (req, res, next, game_review_id) => {
    const gameReview = await getGameReviewById(game_review_id);
    if (!gameReview) {
        return res.status(404).send('Review not found');
    }

    req.gameReview= gameReview;
    next();
});

gameReviewsRouter.get('/:id/games', async (req, res) => {
    const game = await getGameReviewByGameId(req.gameReview.game_id);
    res.send(game);
});

gameReviewsRouter.get('/:id', async (req, res) => {
    const gameReview = await getGameReviewById(req.params.id);
    await incrementGameReviewViewCount(req.params.id);
    res.send(gameReview);
});

// Public endpoint: get vote totals for a review (and user's vote if auth provided)
gameReviewsRouter.get('/:id/votes', async (req, res, next) => {
    try {
        const userId = req.user ? req.user.user_id : null;
        const votes = await getReviewVotes(req.params.id, userId);
        res.send(votes);
    } catch (err) {
        next(err);
    }
});


gameReviewsRouter.get('/', async (req, res) => {
    const gameReviews = await getGameReviews();
    res.send(gameReviews);
});

gameReviewsRouter.use(requireUser);

gameReviewsRouter.patch('/:id', requireBody(['reviewTitle', 'gameReview', 'ratingValue']), async (req, res, next) => {
    const userId = req.user.user_id;

    if (req.gameReview.user_id !== userId) {
        return res.status(403).send('You are not authorized to update this review.');
    }

    try {
        const { reviewTitle, gameReview, ratingValue } = req.body;
        const updatedReview = await updateGameReviewById(req.params.id, userId, reviewTitle, gameReview, ratingValue);
        if (!updatedReview) {
            return res.status(404).send('Review not found.');
        }

        res.send({ message: 'Review updated successfully.', updatedReview });
    } catch (err) {
        next(err);
    }
});

gameReviewsRouter.delete('/:id', async (req, res, next) => {
    const userId = req.user.user_id;

    if (req.gameReview.user_id !== userId) {
        return res.status(403).send('You are not authorized to delete this review.');
    }

    try {
        const deletedReview = await deleteGameReviewById(req.params.id, userId);
        if (!deletedReview) {
            return res.status(404).send('Review not found.');
        }

        res.send({ message: 'Review deleted successfully.', deletedReview });
    } catch (err) {
        next(err);
    }
});

gameReviewsRouter.post('/', requireBody([
    'reviewTitle',
    'gameReview', 
    'gameId',
    'ratingValue'
]), async (req, res, next) => {
    const user_id = req.user.user_id
    const {
        reviewTitle,
        gameReview,
        gameId,
        ratingValue
    } = req.body;

    if (!user_id) {
        return res.status(403).send('You must be signed in to write a review.');
    }

    try {
        const newGameReview = await createGameReviews(
            reviewTitle,
            gameReview,
            gameId,
            ratingValue,
            user_id
        );

        res.status(201).json(newGameReview);
    } catch (err) {
        next(err);
    }
});

gameReviewsRouter.post('/:id/vote', requireBody(['voteValue']), async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const voteValue = Number(req.body.voteValue);
        if (![1, -1].includes(voteValue)) {
            return res.status(400).send('voteValue must be 1 or -1');
        }

        const vote = await upsertReviewVote(req.params.id, userId, voteValue);
        const totals = await getReviewVotes(req.params.id, userId);
        res.status(200).send({ vote, totals });
    } catch (err) {
        next(err);
    }
});

// Remove current user's vote for the review
gameReviewsRouter.delete('/:id/vote', async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const deleted = await deleteReviewVote(req.params.id, userId);
        const totals = await getReviewVotes(req.params.id, userId);
        res.send({ deleted, totals });
    } catch (err) {
        next(err);
    }
});