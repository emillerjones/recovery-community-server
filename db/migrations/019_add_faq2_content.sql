BEGIN;

CREATE TABLE IF NOT EXISTS faq2_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key = 'faq2'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO faq2_pages (page_key, content)
VALUES (
  'faq2',
  $faq$
  {
    "hero": {
      "kicker": "Good Questions. Real Answers.",
      "title": "FAQs — Frequently Asked Questions",
      "intro": "The essentials about this organization, community, privacy, and finding your place here."
    },
    "groups": [
      {
        "key": "community",
        "title": "About This Community",
        "shortTitle": "Community",
        "icon": "leaf",
        "items": [
          {
            "id": "community-for",
            "question": "Who is this community for?",
            "answer": "Anyone using cannabis to reduce or replace their use of alcohol, narcotics, or other dangerous substances — or anyone curious whether this approach might help them or a loved one. Recovery with The Exit Drug is not a program, rather it is a community for like-minded people to find support and resources. We are all-inclusive, meaning we accept anyone in recovery with whatever program or treatment path they might be using."
          },
          {
            "id": "replacing-programs",
            "question": "Is this replacing AA, NA, or other recovery programs?",
            "answer": "No. Many of our members use cannabis as a medication-assisted-treatment (MAT) or as a harm-reduction tool alongside other programs such as Alcoholics Anonymous, Narcotics Anonymous, 12-Step Programs, SMART Recovery, Moderation Management, Refuge Recovery, Celebrate Recovery, etc, or other alternative pathways. — We are not a replacement for those — we are another option that can work alongside them."
          },
          {
            "id": "must-use-cannabis",
            "question": "Do I have to use cannabis to be part of this community?",
            "answer": "No. This community exists for people exploring cannabis as part of their recovery, but you don't have to be actively using it to belong here — many people are simply researching whether this approach is right for them."
          }
        ]
      },
      {
        "key": "privacy",
        "title": "Privacy & Trust",
        "shortTitle": "Privacy & trust",
        "icon": "shield",
        "items": [
          {
            "id": "medical-advice",
            "question": "Is this medical advice?",
            "answer": "No. Recovery With The Exit Drug is a peer support community, not a medical or professional organization. Nothing here is a substitute for professional care. If you need medical or psychiatric support, please seek it from a licensed provider."
          },
          {
            "id": "legality",
            "question": "Is cannabis substitution legal?",
            "answer": "Cannabis laws vary by state and country. We encourage members to understand the laws where they live. This community does not provide legal advice."
          },
          {
            "id": "information-private",
            "question": "Is my information private?",
            "answer": "Please visit our ‘Privacy’ page from the website’s menu for a detailed guide on our privacy policies and the safety of your information."
          }
        ]
      },
      {
        "key": "joining",
        "title": "Joining",
        "shortTitle": "Joining",
        "icon": "door",
        "items": [
          {
            "id": "free",
            "question": "Is this free?",
            "answer": "Yes. Recovery with The Exit Drug is a nonprofit organization. All resources provided are available for free for our members."
          },
          {
            "id": "donations",
            "question": "Do we accept donations?",
            "answer": "Yes. However, we do not require members to donate, but we gratefully accept them through our 'Donation' page to help support and sustain our organization. Any donations over $15 will come with a mailed handwritten thank you note plus free stickers for you to enjoy and share with your friends.\n\nNote: Any donations are not tax-deductible."
          },
          {
            "id": "facebook-group",
            "question": "What happened to the Facebook group?",
            "answer": "Our Facebook group called 'Maintaining My Recovery With Cannabis: Support Group' will continue to be available for members indefinitely. Our hope is to fully transition the Facebook support group over to this website for better safety, moderation control, and easier access for our members."
          }
        ]
      }
    ]
  }
  $faq$::jsonb
)
ON CONFLICT (page_key) DO NOTHING;

COMMIT;
