import express from "express";
const router = express.Router();
export default router;

import { 
    getPendingFriendRequests, 
    getFriendList, 
    sendFriendRequest,
    acceptFriendRequest, 
    denyFriendRequest,
    getBlockList,
    blockUser,
    removeFromBlocklist} from "#db/queries/friendQuery";

import getUserFromToken from "#middleware/getUserFromToken";
import { getUserByUserName } from "#db/queries/users";

const getOrderedIds = (id1, id2) =>{
    return id1 < id2 ? { user_id_1: id1, user_id_2: id2 } : { user_id_1: id2, user_id_2: id1 };
}


//Get list of user's friends
router.get('/', getUserFromToken, async (req, res, next)=>{
    try {
        const friends = await getFriendList(req.user.user_id);
        res.send(friends);
    }catch(err){
        next(err);
    }
});
//Get list of friend requests for the user
router.get('/requests', getUserFromToken, async (req, res, next)=>{
    try {
        const requests = await getPendingFriendRequests(req.user.user_id);
        res.send(requests);
    } catch (err) {
        next(err);
    }
});
//Get list of blocked users. 
router.get('/blocklist', getUserFromToken, async (req, res, next)=>{
    try {
        const requests = await getBlockList(req.user.user_id);
        console.log("Blocklist API call: ", requests);
        res.send(requests);
    } catch (err) {
        next(err);
    }
});
//User send a friend request
router.post('/request/:username', getUserFromToken, async (req, res, next)=>{
    try {
        const {username} = req.params
        const senderId = req.user.user_id;
        const targetUsername = await getUserByUserName(username); 
        if(!targetUsername){
            return res.status(404).send({message: "User not found. Check the spelling."})
        }
        //Gets list of user's pending requests, looks for if any of their id's matches user's
        const pendingRequests = await getPendingFriendRequests(req.user.user_id);
        const alreadyPending = pendingRequests.some(req => req.friend_id === targetUsername.user_id);
        if(alreadyPending){
            return res.status(409).send({message: "Pending request already exists"});
        }
        const { user_id_1, user_id_2 } = getOrderedIds(senderId, targetUsername.user_id);
        const newRequest = await sendFriendRequest(user_id_1, user_id_2, senderId);
        res.status(201).send(newRequest);
    } catch (err) {
        next(err);
    }
});
//User Accepts a friend request
router.post('/accept/:senderId', getUserFromToken, async (req, res, next)=>{
  try {
    const senderId  = Number(req.params.senderId);
    const receiverId = req.user.user_id;
    if(receiverId === senderId){
        return res.status(400).send({message: "You can't accept your own request"});
    }
    const { user_id_1, user_id_2 } = getOrderedIds(senderId, receiverId);
    const acceptFriend = await acceptFriendRequest(user_id_1, user_id_2, receiverId);
    res.status(200).send(acceptFriend);
  }catch(err){
    next(err);
  } 
});
//User Cancels a friend request
router.delete('/request/:senderId', getUserFromToken, async (req, res, next)=>{
    try {
        const senderId  = Number(req.params.senderId);
        const receiverId = req.user.user_id;
   
        const { user_id_1, user_id_2 } = getOrderedIds(senderId, receiverId);
        const cancelFriend = await removeFromBlocklist(user_id_1, user_id_2, receiverId);
        res.status(200).send(cancelFriend);
    }catch(err){
        next(err);
    } 
});

//User denies a friend request (Should also work for removing a friendship)
router.post('/deny/:senderId', getUserFromToken, async (req, res, next)=>{
    try {
        const senderId = Number(req.params.senderId);
        const receiverId = req.user.user_id;
        
        const { user_id_1, user_id_2 } = getOrderedIds(senderId, receiverId);
        const denyRequest = await denyFriendRequest(user_id_1, user_id_2, receiverId);
        res.status(200).send(denyRequest);
    } catch (err) {
        next(err);        
    }
});

//User blocks another user 
router.post('/blocklist/:receiverId', getUserFromToken, async (req, res, next)=>{
    try {
        //receiver = person to be blocked
        const receiverId = Number(req.params.receiverId);
        //sender = person doing the blocking
        const senderId = req.user.user_id;
        const { user_id_1, user_id_2 } = getOrderedIds(senderId, receiverId);
        const blockedPerson = await blockUser(user_id_1, user_id_2, senderId);
        console.log("Block user POST API call: ", blockedPerson);
        res.status(200).send(blockedPerson);
    } catch (err) {
        next(err);
    }
});

router.delete('/blocklist/:receiverId', getUserFromToken, async (req, res, next)=>{
    try {
        //receiver = person to be unblocked
        const receiverId = Number(req.params.receiverId);
        //sender = person doing the unblocking
        const senderId = req.user.user_id;
        const { user_id_1, user_id_2 } = getOrderedIds(senderId, receiverId);
        const blockedPerson = await removeFromBlocklist(user_id_1, user_id_2);
        console.log("unBlock user POST API call: ", blockedPerson);
        res.status(200).send(blockedPerson);
    } catch (err) {
        next(err);
    }
});