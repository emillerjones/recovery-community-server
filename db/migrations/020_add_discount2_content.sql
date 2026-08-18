BEGIN;

CREATE TABLE IF NOT EXISTS discount_pages (
  page_key TEXT PRIMARY KEY CHECK (page_key = 'discountlinks2'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  revision INT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO discount_pages (page_key, content)
VALUES (
  'discountlinks2',
  $discount$
  {
    "hero": {
      "eyebrow": "A Discount For You, A Donation For Us",
      "title": "Cannabis-Friendly Discount Codes & Links.",
      "intro": "This page is a curated collection of partner, referral, and discount links supporting the Recovery With The Exit Drug community."
    },
    "categories": [
      {
        "id": "apparel-advocacy",
        "title": "Apparel & Advocacy",
        "description": "Wear the message and support the movement.",
        "icon": "shirt",
        "brands": [
          { "id": "etsy-exitdrug-shirt", "name": "Etsy #EXITDRUG Advocate T-Shirt", "code": "EXITDRUG", "url": "https://www.etsy.com/shop/TheExitDrugRecovery", "logo": "https://cdn2.lnk.bi/uploads/6288789_20231123040640893-100.jpg", "note": null, "active": true },
          { "id": "ljxldn", "name": "LJXLDN", "code": "SOBERSTONER", "url": "https://www.ljxlondon.co.uk/?ref=SOBERSTONER", "logo": "https://cdn2.lnk.bi/uploads/4284813_20230307111410592-100.jpg", "note": null, "active": true },
          { "id": "8000-kicks", "name": "8000 Kicks", "code": "SOBERSTONER", "url": "https://www.8000kicks.com/discount/SOBERSTONER?ref=SOBERSTONER", "logo": "https://cdn2.lnk.bi/uploads/4284752_20230307104743168-100.jpg", "note": null, "active": true }
        ]
      },
      {
        "id": "cbd-hemp-cannabis-wellness",
        "title": "CBD, Hemp & Cannabis Wellness",
        "description": "Products some members use as part of their recovery routines.",
        "icon": "leaf",
        "brands": [
          { "id": "coast-smokes", "name": "Coast Smokes", "code": "SOBERSTONER", "url": "https://coastsmokes.co/", "logo": "https://cdn2.lnk.bi/uploads/11432104_20251005051805110-100.jpg", "note": null, "active": true },
          { "id": "healer-cbd", "name": "Healer CBD", "code": "SOBERSTONER", "url": "https://healercbd.com/coupon/soberstoner/?ref=237", "logo": "https://cdn2.lnk.bi/uploads/9524041_20250320012844606-100.jpg", "note": null, "active": true },
          { "id": "plain-jane", "name": "Plain Jane", "code": "SOBERSTONER", "url": "https://plainjane.com/soberstoner", "logo": "https://cdn2.lnk.bi/uploads/4570716_20230424095736500-100.jpg", "note": null, "active": true },
          { "id": "pungent-greens-cbd", "name": "Pungent Greens CBD", "code": "SOBERSTONER", "url": "https://pungentgreens.com/collections/all", "logo": "https://cdn2.lnk.bi/uploads/7808780_20240701224418947-100.jpg", "note": null, "active": true },
          { "id": "earthy-now", "name": "Earthy Now", "code": "SOBERSTONER", "url": "https://www.earthynow.com", "logo": "https://cdn2.lnk.bi/uploads/12010744_20251202212756356-100.png", "note": null, "active": true }
        ]
      },
      {
        "id": "vaporizers-devices",
        "title": "Vaporizers & Devices",
        "description": "Device discounts and accessories from partner links.",
        "icon": "cable",
        "brands": [
          { "id": "dynavap", "name": "DYNAVAP", "code": "SOBERSTONER", "url": "https://www.dynavap.com/?ref=LAINIERUTH", "logo": "https://cdn2.lnk.bi/uploads/8407012_20240930212435937-100.jpg", "note": null, "active": true },
          { "id": "airvape", "name": "AirVape", "code": "SOBERSTONER", "url": "https://airvapeusa.com/SOBERSTONER", "logo": "https://cdn2.lnk.bi/uploads/12838899_20260328062943817-100.png", "note": null, "active": true },
          { "id": "rokin-vapes", "name": "Rokin Vapes", "code": "SOBERSTONER", "url": "https://bit.ly/360uWcr", "logo": "https://cdn2.lnk.bi/uploads/4284780_20230307105956885-100.png", "note": null, "active": true },
          { "id": "pulsar", "name": "Pulsar", "code": "SOBERSTONER", "url": "https://www.pulsarvaporizers.com", "logo": "https://cdn2.lnk.bi/uploads/9515343_20250319004625306-100.jpg", "note": null, "active": true },
          { "id": "alien-flower-monkey", "name": "Alien Flower Monkey", "code": "SOBERSTONER15", "url": "https://smokeafm.com/?sca_ref=922024.6EpRtEAC5x", "logo": "https://cdn2.lnk.bi/uploads/4284774_20230307105612588-100.jpg", "note": null, "active": true },
          { "id": "bomb-official", "name": "BOMB Official", "code": "SOBERSTONER", "url": "https://bombofficial.com/?ref=soberstoner", "logo": "https://cdn2.lnk.bi/uploads/10646015_20250724011135189-100.png", "note": null, "active": true },
          { "id": "waxmaid", "name": "Waxmaid", "code": "SOBERSTONER", "url": "https://www.waxmaidstore.com/?ref=soberstoner", "logo": "https://cdn2.lnk.bi/uploads/9356221_20250222235905748-100.jpg", "note": null, "active": true },
          { "id": "solopipe", "name": "SoloPipe", "code": "SOBERSTONER", "url": "https://solopipe.com/?sca_ref=2760079.oNHfbS04OY", "logo": "https://cdn2.lnk.bi/uploads/10667499_20250725215639957-100.jpg", "note": null, "active": true },
          { "id": "puffshot", "name": "PuffShot", "code": "SOBERSTONER", "url": "https://www.puffshotlife.com/?coupon_code=soberstoner", "logo": "https://cdn2.lnk.bi/uploads/9688992_20250412061839539-100.jpg", "note": null, "active": true },
          { "id": "piecemaker", "name": "PieceMaker", "code": "SOBERSTONER", "url": "https://www.piecemaker.com/SOBERSTONER", "logo": "https://cdn2.lnk.bi/uploads/12182626_20251230065926148-100.png", "note": null, "active": true }
        ]
      },
      {
        "id": "storage-filters-accessories",
        "title": "Storage, Filters & Accessories",
        "description": "Practical tools for safer storage, odor control, and daily use.",
        "icon": "package",
        "brands": [
          { "id": "skunk-bags", "name": "Skunk Bags", "code": "SOBERSTONER", "url": "https://skunkbags.com/soberstoner", "logo": "https://cdn2.lnk.bi/uploads/11114314_20250905044301743-100.jpg", "note": null, "active": true },
          { "id": "stashlogix", "name": "Stashlogix", "code": "SOBERSTONER", "url": "https://www.dynavap.com/search?q=Stash%20logix&ref=LAINIERUTH&type=product", "logo": "https://cdn2.lnk.bi/uploads/4284689_20230307102237950-100.jpg", "note": null, "active": true },
          { "id": "vonsploof", "name": "VonSploof Smoke Filters", "code": "SOBERSTONER", "url": "https://vonsploof.com/soberstoner", "logo": "https://cdn2.lnk.bi/uploads/10695815_20250729010653464-100.jpg", "note": null, "active": true },
          { "id": "wakit-grinders", "name": "Wakit Grinders", "code": "SOBERSTONER", "url": "https://www.wakitgrinders.com/coupon/soberstoner/", "logo": "https://cdn2.lnk.bi/uploads/9688921_20250412055734915-100.png", "note": null, "active": true },
          { "id": "king-palm", "name": "King Palm", "code": "SOBERSTONER", "url": "https://kingpalm.com", "logo": "https://cdn2.lnk.bi/uploads/13010017_20260422071349419-100.jpg", "note": null, "active": true },
          { "id": "daysavers", "name": "DaySavers", "code": "SOBERSTONER", "url": "https://daysavers.com/?ref=SOBERSTONER", "logo": "https://cdn2.lnk.bi/uploads/12773570_20260320020532176-100.jpg", "note": null, "active": true },
          { "id": "hemp-wick-bee-line", "name": "Hemp Wick Bee Line", "code": "SOBERSTONER", "url": "https://www.hempwickbeeline.com/shop", "logo": "https://cdn2.lnk.bi/uploads/6586149_20240104102734627-100.jpg", "note": null, "active": true },
          { "id": "mooselabs", "name": "MooseLabs", "code": "SOBERSTONER", "url": "https://i.refs.cc/0m9M7O2m?smile_ref=eyJzbWlsZV9zb3VyY2UiOiJzbWlsZV91aSIsInNtaWxlX21lZGl1bSI6IiIsInNtaWxlX2NhbXBhaWduIjoicmVmZXJyYWxfcHJvZ3JhbSIsInNtaWxlX2N1c3RvbWVyX2lkIjoxODIzMjg1NTA4fQ%3D%3D", "logo": "https://cdn2.lnk.bi/uploads/5351224_20230809175814716-100.png", "note": null, "active": true }
        ]
      },
      {
        "id": "gummies-mints-beverages",
        "title": "Gummies, Mints & Beverages",
        "description": "Partner links for edible-style products, mints, and drinks.",
        "icon": "candy",
        "brands": [
          { "id": "snoozy", "name": "Snoozy Gummy Discount Link", "code": null, "url": "https://snwbl.io/snoozy/SOBERSTONER", "logo": "https://cdn2.lnk.bi/uploads/9153322_20250128220112811-100.png", "note": "Use this link, then click “Redeem Coupon.”", "active": true },
          { "id": "vitabar", "name": "VitaBar", "code": "SOBERSTONER", "url": "https://snwbl.io/vitabar/SOBERSTONER", "logo": "https://cdn2.lnk.bi/uploads/6452592_20231213215737236-100.png", "note": null, "active": true },
          { "id": "nokkomo", "name": "Nokkomo Mouth Watering Mints", "code": "SOBERSTONER", "url": "https://nokkomomints.com/?sca_ref=9800224.dqeOoKF1R8tZSvIC", "logo": "https://cdn2.lnk.bi/uploads/11559300_20251017005222148-100.png", "note": null, "active": true },
          { "id": "mitra9", "name": "Mitra9 Beverages", "code": "SOBERSTONER", "url": "https://mitra-9.com/?ref=SOBERSTONER", "logo": "https://cdn2.lnk.bi/uploads/12067418_20251211013838861-100.jpg", "note": null, "active": true }
        ]
      }
    ],
    "guide": {
      "eyebrow": "Using your discount",
      "title": "Save on products while supporting our community.",
      "intro": "Explore cannabis-friendly brands offering our community exclusive discounts on high-quality cannabis products. When you use our referral links and discount codes, a portion of your purchase is donated to our nonprofit organization.",
      "highlights": [
        "These contributions help us sustain and expand the resources we provide to our community free of charge.",
        "Thank you for supporting our mission!"
      ],
      "updated": "This list is updated often, so please check back to see new brand discounts!",
      "directions": [
        "Select a brand from our list.",
        "Click “COPY” to copy the brand’s discount code.",
        "Click the brand’s link to visit their website.",
        "Add your desired products to your cart.",
        "At checkout, enter or paste our discount code in the “Coupon/Promo/Discount Code” field.",
        "Your discount will be applied to your order total."
      ],
      "notes": [
        "Our discount codes can be used unlimited times.",
        "Feel free to share codes with friends, but please do not promote them publicly online.",
        "Discount codes cannot be combined with other promotional codes.",
        "Some brands may require a minimum purchase amount for the discount to apply."
      ],
      "contactText": "For issues with a link or discount code, or for product recommendations, contact our Founder/Admin, Lainie Ruth, at",
      "contactEmail": "thesoberstoner420@gmail.com"
    },
    "disclaimer": "Some links may be affiliate or referral links. Products listed here are not medical advice and are not a substitute for professional care. Always follow your local laws."
  }
  $discount$::jsonb
)
ON CONFLICT (page_key) DO NOTHING;

COMMIT;
