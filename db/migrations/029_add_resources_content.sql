BEGIN;

CREATE TABLE IF NOT EXISTS resource_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key = 'resources'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO resource_pages (page_key, content)
VALUES ('resources', $resources${
  "hero": {
    "kicker": "The recovery field guide",
    "title": "Information for finding your own way.",
    "intro": "Research, lived experience, and outside support—collected carefully so the next useful direction is easier to find."
  },
  "learnIntro": "A starting point, not a substitute for medical advice. These are articles, studies, and videos members have found useful over the years.",
  "supportIntro": "We're rebuilding this directory of independent organizations — not part of Recovery With The Exit Drug — to make sure it stays current and accurate.",
  "categories": [
    {
      "id": "substitution",
      "title": "Substitution & Harm Reduction",
      "section": "learn",
      "links": [
        {
          "id": "substitution-1",
          "text": "Can We Unlock Marijuana's Potential as an \"Exit Drug\"?",
          "url": "http://www.substance.com/can-we-unlock-marijuanas-potential-as-an-exit-drug/8312/",
          "tag": ""
        },
        {
          "id": "substitution-2",
          "text": "Considering Marijuana Maintenance: Cannabis as a Substitution Therapy for Alcoholism",
          "url": "http://www.choosehelp.com/topics/harm-reduction/marijuana-cannabis-substitution-alcoholism",
          "tag": ""
        },
        {
          "id": "substitution-3",
          "text": "\"Marijuana Recovery\": The newest option for recovering substance addicts?",
          "url": "https://www.psychologytoday.com/blog/addiction-beat/201307/marijuana-recovery",
          "tag": ""
        },
        {
          "id": "substitution-4",
          "text": "The Likely Cause of Addiction Has Been Discovered, and It Is Not What You Think",
          "url": "http://www.huffingtonpost.com/johann-hari/the-real-cause-of-addicti_b_6506936.html",
          "tag": ""
        },
        {
          "id": "substitution-5",
          "text": "The real 'gateway drug' is 100% legal",
          "url": "https://www.washingtonpost.com/news/wonk/wp/2016/01/06/the-real-gateway-drug-thats-everywhere-and-legal/?postshare=9281452192404656&tid=ss_fb-bottom",
          "tag": ""
        },
        {
          "id": "substitution-6",
          "text": "What is harm reduction? (Harm Reduction International)",
          "url": "http://www.ihra.net/what-is-harm-reduction",
          "tag": ""
        },
        {
          "id": "substitution-7",
          "text": "A safer alternative: Cannabis substitution as harm reduction",
          "url": "http://www.ncbi.nlm.nih.gov/pubmed/25919477?report=abstract",
          "tag": ""
        },
        {
          "id": "substitution-8",
          "text": "Can Cannabis Be Considered a Substitute Medication for Alcohol?",
          "url": "http://www.medscape.com/viewarticle/825298",
          "tag": ""
        },
        {
          "id": "substitution-9",
          "text": "Cannabis Substitution: Harm Reduction Treatment for Alcoholism and Drug Dependence (Tod H. Mikuriya, MD & Jerry Mandel, PhD)",
          "url": "http://mikuriyamedical.com/about/cw_cansub.html",
          "tag": ""
        },
        {
          "id": "substitution-10",
          "text": "Cannabis Substitution: Marijuana Maintenance as Addiction Treatment (Featuring: Amanda Reiman, PhD and Kenneth Anderson, MA)",
          "url": "https://youtu.be/6Nt5ZXtX4Ts",
          "tag": "Video"
        },
        {
          "id": "substitution-11",
          "text": "Everything We Think We Know About Addiction Is Wrong",
          "url": "https://youtu.be/ao8L-0nSYzg",
          "tag": "Video"
        }
      ]
    },
    {
      "id": "alcohol",
      "title": "Alcohol-Specific",
      "section": "learn",
      "links": [
        {
          "id": "alcohol-1",
          "text": "Medical Marijuana and Alcoholism",
          "url": "https://www.whaxy.com/learn/cannabis-treament-for-alcoholism",
          "tag": ""
        },
        {
          "id": "alcohol-2",
          "text": "Study Shows Marijuana Often Substituted for Alcohol and Other Drugs",
          "url": "http://blog.mpp.org/research/study-shows-marijuana-often-substituted-for-alcohol-and-other-drugs/",
          "tag": ""
        },
        {
          "id": "alcohol-3",
          "text": "Cannabis as a Substitute for Alcohol: A Harm-Reduction Approach (Tod H. Mikuriya, MD)",
          "url": "http://mikuriyamedical.com/about/cw_alcsub.pdf",
          "tag": ""
        },
        {
          "id": "alcohol-4",
          "text": "Marijuana Maintenance: Cannabis for Alcohol Dependence (Featuring Kenneth Anderson of HAMS Network)",
          "url": "https://www.youtube.com/watch?v=bXM5YpR0Gf4",
          "tag": "Video"
        },
        {
          "id": "alcohol-5",
          "text": "smoking weed in AA",
          "url": "http://www.bluelight.org/vb/threads/679991-smoking-weed-in-AA",
          "tag": "Forum"
        },
        {
          "id": "alcohol-6",
          "text": "The Alcoholic Fights for His Herb by \"Mr. W.\"",
          "url": "http://marijuana-uses.com/the-alcoholic-fights-for-his-herb/",
          "tag": "Forum"
        }
      ]
    },
    {
      "id": "opioid",
      "title": "Opioid-Specific",
      "section": "learn",
      "links": [
        {
          "id": "opioid-1",
          "text": "Can Medical Marijuana Curb Heroin Addiction?",
          "url": "http://www.alternet.org/drugs/medical-marijuana-cure-heroin-epidemic",
          "tag": ""
        },
        {
          "id": "opioid-2",
          "text": "Marijuana Use Helped Me Kick My Opiate Addiction — It Could Help Others",
          "url": "http://reset.me/story/marijuana-use-increasingly-accepted-12-step-programs/",
          "tag": ""
        },
        {
          "id": "opioid-3",
          "text": "Opioid Addiction Being Treated With Medical Marijuana in Massachusetts",
          "url": "http://www.drugfree.org/join-together/opioid-addiction-treated-medical-marijuana-massachusetts/",
          "tag": ""
        },
        {
          "id": "opioid-4",
          "text": "Trading Opiates for Marijuana to Treat Pain",
          "url": "http://www.doctoroz.com/episode/trading-opiates-marijuana-treat-pain",
          "tag": "Video"
        }
      ]
    },
    {
      "id": "personal",
      "title": "Personal Accounts",
      "section": "learn",
      "links": [
        {
          "id": "personal-1",
          "text": "How I Smoked My Way Sober",
          "url": "http://www.buzzfeed.com/katieherzog/how-i-smoked-my-way-sober?utm_term=.qtEr2l0nK#.muQkQ0doe",
          "tag": ""
        },
        {
          "id": "personal-2",
          "text": "Secret \"Sober\" Pot Smokers",
          "url": "https://www.thefix.com/content/secret-%E2%80%9Csober%E2%80%9D-pot-users2030",
          "tag": ""
        }
      ]
    },
    {
      "id": "research",
      "title": "Research & Safety",
      "section": "learn",
      "links": [
        {
          "id": "research-1",
          "text": "Here's How Many People Fatally Overdosed on Marijuana Last Year (2015)",
          "url": "http://www.huffingtonpost.com/entry/marijuana-deaths-2014_56814617e4b06fa68880a217",
          "tag": ""
        },
        {
          "id": "research-2",
          "text": "Study: Patients Substitute Cannabis For Booze, Prescription Drugs",
          "url": "http://norml.org/news/2015/10/08/study-patients-substitute-cannabis-for-booze-prescription-drugs",
          "tag": ""
        },
        {
          "id": "research-3",
          "text": "The science behind cannabinoids is clear: marijuana helps brain achieve breakthroughs in learning, consciousness and understanding",
          "url": "http://www.naturalnews.com/051164_cannabinoids_mental_capacity_marijuana.html",
          "tag": ""
        },
        {
          "id": "research-4",
          "text": "Using Medical Marijuana Doesn't Increase Risk of Drug Abuse, Study Concludes",
          "url": "http://www.healthline.com/health-news/using-medical-marijuana-doesnt-increase-risk-of-drug-abuse-051815#1",
          "tag": ""
        },
        {
          "id": "research-5",
          "text": "Pregnenolone Can Protect the Brain from Cannabis Intoxication",
          "url": "http://science.sciencemag.org/content/343/6166/94",
          "tag": ""
        },
        {
          "id": "research-6",
          "text": "Use of prescription pain medications among medical cannabis patients: comparisons of pain levels, functioning, and patterns of alcohol and other drug use.",
          "url": "http://www.ncbi.nlm.nih.gov/pubmed/25978826",
          "tag": ""
        },
        {
          "id": "research-7",
          "text": "Dr. Oz & Dr. Devi Nampiaparampil on Using Marijuana for Pain",
          "url": "http://www.doctoroz.com/episode/trading-opiates-marijuana-treat-pain",
          "tag": "Video"
        }
      ]
    }
  ]
}$resources$::jsonb)
ON CONFLICT (page_key) DO NOTHING;

COMMIT;
