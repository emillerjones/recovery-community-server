// Fixed editable text fields for Home - Test; actions and presentation stay in code.
export const HOME_TEST_SECTIONS = [
  {
    "id": "hero",
    "title": "Opening introduction",
    "fields": [
      {
        "key": "established",
        "label": "Established label",
        "maxLength": 30,
        "multiline": false
      },
      {
        "key": "year",
        "label": "Established year",
        "maxLength": 20,
        "multiline": false
      },
      {
        "key": "titleFirst",
        "label": "Main heading - first line",
        "maxLength": 80,
        "multiline": false
      },
      {
        "key": "titleSecond",
        "label": "Main heading - second line",
        "maxLength": 80,
        "multiline": false
      },
      {
        "key": "former",
        "label": "Former name",
        "maxLength": 300,
        "multiline": false
      },
      {
        "key": "description",
        "label": "Introduction",
        "maxLength": 1200,
        "multiline": true
      }
    ]
  },
  {
    "id": "purpose",
    "title": "Founding purpose",
    "fields": [
      {
        "key": "kicker",
        "label": "Small heading",
        "maxLength": 120,
        "multiline": false
      },
      {
        "key": "mission",
        "label": "Mission statement",
        "maxLength": 2400,
        "multiline": true
      },
      {
        "key": "supportText",
        "label": "Support invitation",
        "maxLength": 800,
        "multiline": true
      }
    ]
  },
  {
    "id": "principles",
    "title": "What we are rooted in",
    "fields": [
      {
        "key": "kicker",
        "label": "Small heading",
        "maxLength": 120,
        "multiline": false
      },
      {
        "key": "title",
        "label": "Section title",
        "maxLength": 180,
        "multiline": false
      },
      {
        "key": "intro",
        "label": "Introduction",
        "maxLength": 800,
        "multiline": true
      },
      {
        "key": "title1",
        "label": "Principle 1 - title",
        "maxLength": 240,
        "multiline": false
      },
      {
        "key": "text1",
        "label": "Principle 1 - explanation",
        "maxLength": 1800,
        "multiline": true
      },
      {
        "key": "title2",
        "label": "Principle 2 - title",
        "maxLength": 240,
        "multiline": false
      },
      {
        "key": "text2",
        "label": "Principle 2 - explanation",
        "maxLength": 1800,
        "multiline": true
      },
      {
        "key": "title3",
        "label": "Principle 3 - title",
        "maxLength": 240,
        "multiline": false
      },
      {
        "key": "text3",
        "label": "Principle 3 - explanation",
        "maxLength": 1800,
        "multiline": true
      },
      {
        "key": "title4",
        "label": "Principle 4 - title",
        "maxLength": 240,
        "multiline": false
      },
      {
        "key": "text4",
        "label": "Principle 4 - explanation",
        "maxLength": 1800,
        "multiline": true
      }
    ]
  },
  {
    "id": "provides",
    "title": "What we provide",
    "fields": [
      {
        "key": "kicker",
        "label": "Small heading",
        "maxLength": 120,
        "multiline": false
      },
      {
        "key": "title",
        "label": "Section title",
        "maxLength": 180,
        "multiline": false
      },
      {
        "key": "intro",
        "label": "Introduction",
        "maxLength": 800,
        "multiline": true
      },
      {
        "key": "title1",
        "label": "Offering 1 - title",
        "maxLength": 180,
        "multiline": false
      },
      {
        "key": "text1",
        "label": "Offering 1 - description",
        "maxLength": 1400,
        "multiline": true
      },
      {
        "key": "title2",
        "label": "Offering 2 - title",
        "maxLength": 180,
        "multiline": false
      },
      {
        "key": "text2",
        "label": "Offering 2 - description",
        "maxLength": 1400,
        "multiline": true
      },
      {
        "key": "title3",
        "label": "Offering 3 - title",
        "maxLength": 180,
        "multiline": false
      },
      {
        "key": "text3",
        "label": "Offering 3 - description",
        "maxLength": 1400,
        "multiline": true
      },
      {
        "key": "title4",
        "label": "Offering 4 - title",
        "maxLength": 180,
        "multiline": false
      },
      {
        "key": "text4",
        "label": "Offering 4 - description",
        "maxLength": 1400,
        "multiline": true
      }
    ]
  },
  {
    "id": "social",
    "title": "Stay connected",
    "fields": [
      {
        "key": "kicker",
        "label": "Small heading",
        "maxLength": 120,
        "multiline": false
      },
      {
        "key": "title",
        "label": "Section title",
        "maxLength": 180,
        "multiline": false
      },
      {
        "key": "intro",
        "label": "Introduction",
        "maxLength": 1000,
        "multiline": true
      },
      {
        "key": "facebookTitle",
        "label": "Facebook heading",
        "maxLength": 80,
        "multiline": false
      },
      {
        "key": "facebookText",
        "label": "Facebook description",
        "maxLength": 500,
        "multiline": true
      },
      {
        "key": "instagramTitle",
        "label": "Instagram heading",
        "maxLength": 80,
        "multiline": false
      },
      {
        "key": "instagramText",
        "label": "Instagram description",
        "maxLength": 500,
        "multiline": true
      }
    ]
  },
  {
    "id": "disclaimer",
    "title": "Disclaimer",
    "fields": [
      {
        "key": "label",
        "label": "Heading",
        "maxLength": 100,
        "multiline": false
      },
      {
        "key": "text",
        "label": "Disclaimer text",
        "maxLength": 2400,
        "multiline": true
      }
    ]
  }
];

export const HOME_TEST_INITIAL_CONTENT = {
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
};
