BEGIN;

CREATE TABLE IF NOT EXISTS guidelines_pages (
 page_key TEXT PRIMARY KEY CHECK (page_key = 'guidelines'),
 content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
 revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
 updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO guidelines_pages (page_key, content)
VALUES ('guidelines', $guidelines${
  "page": {
    "eyebrow": "Our community culture",
    "title": "GUIDELINES",
    "intro": "All members must agree to follow these guidelines and acknowledge the disclaimer below:",
    "sideLabel": "What holds us together",
    "sideTitle1": "Trust.",
    "sideTitle2": "Privacy.",
    "sideTitle3": "Respect.",
    "sideText": "These guidelines protect our community and help everyone feel safe, supported, and able to be honest.",
    "charterLabel": "Community charter",
    "contactLead": "Please contact our Admin,",
    "contactName": "Lainie Ruth",
    "contactTail": "with any questions or concerns.",
    "disclaimerLabel": "Disclaimer:",
    "disclaimerText": "Recovery with The Exit Drug’s private forum is a free peer-to-peer support group. This is not a professional or medical organization. Anything provided in this group forum is for supportive and informational purposes only. We are not a substitute for professional or medical care."
  },
  "items": [
    {
      "id": "01",
      "icon": "LockKeyhole",
      "title": "Respect Everyone’s Privacy — What’s Shared Stays in the Private Group Forum",
      "text": "Protecting the privacy and trust of every member is essential to maintaining a safe environment. Please do not share, repeat, screenshot, copy, or distribute another member’s posts, comments, personal experiences, or identifying information outside of our group forum. What members share here should stay here. Please note that sharing information online may involve certain risks."
    },
    {
      "id": "02",
      "icon": "Heart",
      "title": "Be Kind and Considerate",
      "text": "Treat everyone with kindness, consideration and compassion. Always be mindful of another member’s feelings and communicate respectfully. Differences in opinions and experiences are welcome, but personal attacks are not. We’re here to support one another, not judge or criticize."
    },
    {
      "id": "03",
      "icon": "UsersRound",
      "title": "We Are Non-Judgmental & All-Inclusive",
      "text": "We remain non-judgmental and all-inclusive towards all members at all times. All member posts and comments should refrain from using profanity, jokes, sarcasm, disrespect and negativity that could incite offense to another member. We may not always see eye to eye, and that’s okay. Let’s agree to disagree with care and understanding."
    },
    {
      "id": "04",
      "icon": "MegaphoneOff",
      "title": "No Sales, Promotions, Spam or Unsolicited Advice",
      "text": "We do not post spam, advertisements, promotional content, sales, irrelevant links or unsolicited advice. This includes, but is not limited to, promoting or selling products, businesses, or services of any kind."
    },
    {
      "id": "05",
      "icon": "Ban",
      "title": "No Illegal Activity",
      "text": "Do not use our service for any unlawful purposes. We do not endorse going against your current local laws regarding substance use or possession. We are not here to advise on how to circumvent the law. Posts asking about how to pass a drug test or the likelihood of success in a criminal act are prohibited. Do not post information on how to smuggle, ship, hide, manufacture, or distribute illegal substances."
    },
    {
      "id": "06",
      "icon": "MessageCircle",
      "title": "Stay on Topic",
      "text": "Our group forum is intended only to provide a supportive space for members to share their personal experiences, challenges, questions, and insights related to cannabis, substance use, addiction, and recovery. We do not allow discussions centered on religion, politics, or other unrelated subjects."
    },
    {
      "id": "07",
      "icon": "Image",
      "title": "Image & Meme Sharing",
      "text": "Any sharing of an image or meme must be accompanied by original written text from the member posting. All images and memes posted alone, that go against guidelines or are off-topic will be declined."
    },
    {
      "id": "08",
      "icon": "ShieldCheck",
      "title": "Admin & Moderators",
      "text": "The admin/moderators are here to closely facilitate activity and uphold group forum guidelines. They reserve the right to remove membership, posts, and comments due to noncompliance with the rules. Please note that moderators are generous volunteers and are not paid professionals. For any questions or concerns, all members may contact the Admin, Lainie Ruth, through private message or on the “Contact Us” page."
    }
  ]
}$guidelines$::jsonb)
ON CONFLICT (page_key) DO NOTHING;

COMMIT;
