BEGIN;

CREATE TABLE IF NOT EXISTS home_test_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key = 'home-test'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO home_test_pages (page_key, content)
VALUES ('home-test', $home_test${
  "hero": {
    "established": "EST.",
    "year": "2013",
    "titleFirst": "Recovery with",
    "titleSecond": "The Exit-Drug",
    "former": "Formerly known as Maintaining My Recovery with Cannabis (MMRC)",
    "description": "A recovery support community for people using cannabis to reduce or replace dangerous and addictive substances. Find peer support, educational resources, recovery stories, and connection without judgment."
  },
  "purpose": {
    "kicker": "Our founding purpose",
    "mission": "The mission of Recovery with The Exit-Drug (formerly known as Maintaining My Recovery with Cannabis/MMRC) is to develop a recovery support community of people who use cannabis as a form of harm-reduction therapy from dangerous or addictive substances. We provide support through personal experiences, educational resources, and peer support programs—while upholding a culture of inclusiveness and mutual respect.",
    "supportText": "Help support our nonprofit organization through monetary gifts, our Etsy store & our affiliate discount codes."
  },
  "principles": {
    "kicker": "What we are rooted in",
    "title": "Principles We Uphold",
    "intro": "The following principles are what guide and shape our mission.",
    "title1": "Harm-Reduction Saves Lives",
    "text1": "We promote harm-reduction that is an evidence-based approach to address substance use disorders through prevention, treatment, and recovery that ‘meets people where they are at’ with dignity, kindness and respect regardless of condition or circumstance.",
    "title2": "Recovery has Many Pathways",
    "text2": "We recognize that recovery is deeply personal and what works for one person may not work for another. Approaching all recovery methods with openness and without judgment is far more effective than shaming someone because their path to recovery looks different from the traditional approach.",
    "title3": "Medication-Assisted-Treatment (MAT) & Plant-Medicine is Health Care",
    "text3": "These modalities are healthcare because they treat substance use disorders and mental health as real medical conditions. They use science, clinical evidence, and history to heal the brain and the body.",
    "title4": "Connection & Compassion Heal; Shame & Stigma Hurt",
    "text4": "By placing compassion and connection at the center of recovery, we can help foster healing while also contributing to a broader cultural shift from shame and stigma toward understanding and support."
  },
  "provides": {
    "kicker": "Creating an impact",
    "title": "What We Provide",
    "intro": "The following resources offer compassionate support, meaningful connections, and helpful information.",
    "title1": "Peer support group",
    "text1": "A first of its kind moderated community support forum of like-minded individuals sharing personal experience about cannabis and recovery.",
    "title2": "Education",
    "text2": "A list of informational articles, scientific research, and other resources to learn about cannabis, recovery and more.",
    "title3": "Recovery Stories",
    "text3": "Real voices publicly sharing their journeys of recovery with cannabis to help inspire others.",
    "title4": "Future projects",
    "text4": "We are always growing to add additional features that will benefit our community."
  },
  "social": {
    "kicker": "Stay connected",
    "title": "Help our community grow.",
    "intro": "Follow us for recovery encouragement, community updates, and stories worth sharing. Sharing our posts can help others find support here.",
    "facebookTitle": "Facebook",
    "facebookText": "Community updates and recovery encouragement.",
    "instagramTitle": "Instagram",
    "instagramText": "Stories, inspiration, and educational posts."
  },
  "disclaimer": {
    "label": "Disclaimer",
    "text": "Recovery with The Exit Drug is a volunteer support group sharing practical information. This is not a professional or medical organization. The information provided is for informational and educational purposes only and is not a substitute for professional care."
  }
}$home_test$::jsonb)
ON CONFLICT (page_key) DO NOTHING;

COMMIT;
