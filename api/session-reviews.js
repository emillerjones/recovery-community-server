import express from 'express';
import requireBody from '#middleware/requireBody';
import requireUser from '#middleware/requireUser';
import { createSessionReview, getSessionReviewsBySessionId, updateSessionReviewById } from '#db/queries/sessionReviews';

const sessionReviewsRouter = express.Router();

sessionReviewsRouter.post(
  '/',
  requireUser,
  requireBody(['session_id', 'session_rating', 'member_ratings']),
  async (req, res) => {
    try {
      const { session_id, session_rating, member_ratings } = req.body;
      const review = await createSessionReview({
        session_id,
        user_id: req.user.user_id,
        session_rating,
        member_ratings,
      });
      res.status(201).json(review);
    } catch (err) {
      console.error('Session review insert failed:', err);
      res.status(500).send('Error saving session review');
    }
  }
);

sessionReviewsRouter.put(
  '/:reviewId',
  requireUser,
  requireBody(['session_rating', 'member_ratings']),
  async (req, res) => {
    try {
      const { reviewId } = req.params;
      const { session_rating, member_ratings } = req.body;
      const updatedReview = await updateSessionReviewById(
        reviewId,
        req.user.user_id,
        session_rating,
        member_ratings
      );

      if (!updatedReview) {
        return res.status(404).send('Session review not found or not owned by user');
      }

      res.json(updatedReview);
    } catch (err) {
      console.error('Session review update failed:', err);
      res.status(500).send('Error updating session review');
    }
  }
);

sessionReviewsRouter.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const reviews = await getSessionReviewsBySessionId(sessionId);
    res.send(reviews);
  } catch (err) {
    console.error('Failed to fetch session reviews:', err);
    res.status(500).send('Error fetching session reviews');
  }
});

export default sessionReviewsRouter;