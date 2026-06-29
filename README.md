
npm run db:reset
npm install -g nodemon
Now it auto-restarts whenever you save a file
http://localhost:3000/api/games/populate-images
npm run db:reset

git checkout main
git pull origin main

node --env-file=.env scripts/populateGamesFromIgdb.js

xbl emj api key 
05203028-7708-4538-8499-dffda1f36613


4/29/2026 - testing first upload after branch

Loot Link - EMJ

Loot Link is a social gaming platform designed to bring your recent play sessions, achievements, and gaming connections into one place. Instead of jumping between platforms, it gives you a centralized hub to track what you’ve been playing, who you’ve been playing with, and what you’ve accomplished. The goal is simple: make your gaming activity feel connected, visible, and a little more meaningful.

At its core, Loot Link acts like a personal gaming dashboard. It highlights your recent sessions, surfaces relevant groups you can jump back into, and keeps your social gaming network active—even when you’re not currently in-game. It’s built to feel like *your* home base, not just another list of data.

---

## Navigation Overview

**Home**
Your personal dashboard. This page shows high-level stats like achievements or trophies, your current active session (if any), and quick access to sessions you can rejoin. It also surfaces sessions from recently played games, friends, and players you’ve interacted with before.

**Sessions**
A full view of available gaming sessions. This is where you can browse, join, or create sessions based on what you want to play. It acts as the main discovery area for finding active groups.

**My Games**
A personalized list of games you’ve played or are eligible to review. This section is designed to grow into a review and tracking system, similar to platforms like Letterboxd—but for games.

**Friends**
Your connected players. This section helps you manage your friends list and quickly find sessions involving people you already know.

**Invites**
A dedicated space for incoming and outgoing session invites. Keeps coordination simple so you can jump into games without digging through messages.

---

## Vision

Loot Link is built around the idea that gaming is better when it’s social, persistent, and easy to jump back into. Instead of losing track of sessions or people, everything stays connected—so you spend less time organizing and more time actually playing.

## Updates by Adam

**LFG Engine & Session Logic**
1. Implemented Sessions allowing users to create, join, and browse live lobbies.
2. Developed CreateSessionDialog to launch lobbies directly from the Games catalog.
3. Added Quick Join functionality to the Sessions catalog for instant player matching.
4. Built a SessionDetail to track player counts and lobby status in real-time.

**Database & API Architecture**
1. Expanded the SQL query layer to handle relational session data and player membership.
2. Integrated Session-to-User bridging to ensure data integrity during lobby transitions.
3. Standardized API response codes for lobby actions (201 Created, 400 Already Joined).