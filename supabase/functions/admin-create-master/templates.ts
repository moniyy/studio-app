// Starting points for a new studio, by niche: services with typical US durations
// and prices (the master adjusts them in her dashboard), policies, assistant
// answers, "Before your visit" and aftercare. No deposits: she turns them on
// herself once she adds a way to get paid.

export type Svc = {
  category: string; name: string; description: string; duration_min: number; buffer_min: number;
  price: number; price_from?: boolean; fill_weeks?: number; includes?: string[];
};
export type Faq = { q: string; a: string; keywords: string[] };
export type Template = {
  label: string; tagline: string; services: Svc[];
  policies: { title: string; text: string }[]; faq: Faq[]; prep: string[]; aftercare: { step: string; text: string }[];
};

const CANCEL = { title: 'Cancellations', text: 'Cancel or move your appointment in the app up to 24 hours before — free. Later changes are marked as late.' };
const LATE = { title: 'Late arrivals', text: 'Running late? Please text. After 15 minutes we may need to shorten your service or move you to another time.' };
const NOSHOW = { title: 'No-shows', text: 'A missed appointment without notice is noted on your profile. After two, a deposit is needed for future bookings.' };

const LASH_SVCS: Svc[] = [
  { category: 'Lashes', name: 'Classic Full Set', description: 'One extension on every natural lash — soft, mascara-like and natural.', duration_min: 120, buffer_min: 15, price: 150, fill_weeks: 3, includes: ['Consultation & lash mapping', 'Aftercare spoolie'] },
  { category: 'Lashes', name: 'Hybrid Full Set', description: 'Classic lashes mixed with light fans — textured, wispy and fuller.', duration_min: 135, buffer_min: 15, price: 180, fill_weeks: 3, includes: ['Consultation & lash mapping', 'Aftercare spoolie'] },
  { category: 'Lashes', name: 'Volume Full Set', description: 'Handmade fans on every lash for a full, fluffy, dramatic look.', duration_min: 150, buffer_min: 15, price: 210, fill_weeks: 3, includes: ['Consultation & lash mapping', 'Aftercare spoolie'] },
  { category: 'Lashes', name: 'Lash Fill (2–3 weeks)', description: 'Refresh your set within 3 weeks — at least 40% of extensions remaining.', duration_min: 75, buffer_min: 15, price: 75, fill_weeks: 3 },
  { category: 'Lashes', name: 'Lash Lift & Tint', description: 'Your own lashes, lifted from the root and tinted darker. Lasts 6–8 weeks.', duration_min: 60, buffer_min: 10, price: 95, fill_weeks: 7 },
  { category: 'Lashes', name: 'Lash Removal', description: 'Gentle, safe removal of extensions with a cream remover.', duration_min: 30, buffer_min: 5, price: 35 }
];
const BROW_SVCS: Svc[] = [
  { category: 'Brows', name: 'Brow Shaping', description: 'Shape mapped to your face with soft wax and tweezers.', duration_min: 30, buffer_min: 10, price: 35, fill_weeks: 4 },
  { category: 'Brows', name: 'Brow Shape & Tint', description: 'Shaping plus a tint that frames your face for 3–4 weeks.', duration_min: 45, buffer_min: 10, price: 55, fill_weeks: 4 },
  { category: 'Brows', name: 'Brow Lamination', description: 'Brushed-up, fuller-looking brows that stay in place for 6–8 weeks.', duration_min: 60, buffer_min: 10, price: 85, fill_weeks: 7 },
  { category: 'Brows', name: 'Brow Lamination & Tint', description: 'Lamination, tint and a clean-up shape — the full brow refresh.', duration_min: 75, buffer_min: 10, price: 105, fill_weeks: 7 },
  { category: 'Brows', name: 'Henna Brows', description: 'Tints hair and skin for a soft, defined look that lasts up to 2 weeks on skin.', duration_min: 60, buffer_min: 10, price: 80, fill_weeks: 4 },
  { category: 'Brows', name: 'Brow Tint', description: 'A quick tint to deepen color and add definition.', duration_min: 20, buffer_min: 5, price: 25, fill_weeks: 4 }
];
const LASH_FAQ: Faq[] = [
  { q: 'How long do lash extensions last?', a: 'With good aftercare a set looks full for 2–3 weeks — most clients book a fill every 2–3 weeks.', keywords: ['last', 'long', 'fill', 'weeks'] },
  { q: 'Can I wear mascara with extensions?', a: 'Skip mascara on extensions — it clumps them and weakens the bond. Your set already does the work ✨', keywords: ['mascara', 'makeup'] },
  { q: 'Classic, hybrid or volume — which one?', a: 'Classic is one extension per lash (natural), hybrid mixes classic and fans (textured), volume uses light fans (full and fluffy). Not sure? Book hybrid and we’ll map it together.', keywords: ['classic', 'hybrid', 'volume', 'difference', 'which'] },
  { q: 'Do extensions damage natural lashes?', a: 'Not when they’re applied and removed properly — the weight is matched to your natural lashes.', keywords: ['damage', 'natural', 'safe', 'ruin'] }
];
const BROW_FAQ: Faq[] = [
  { q: 'How long does brow lamination last?', a: 'Usually 6–8 weeks, depending on your hair and how you care for it the first 24 hours.', keywords: ['lamination', 'last', 'long'] },
  { q: 'How long does a brow tint last?', a: 'About 3–4 weeks on the hair; it fades softly.', keywords: ['tint', 'last', 'fade'] },
  { q: 'Should I grow my brows out first?', a: 'If you can, let them grow for 3–4 weeks — more hair gives more to shape.', keywords: ['grow', 'before', 'tweeze', 'pluck'] }
];
const LASH_PREP = ['Come with clean lashes — no mascara or eye makeup', 'Skip caffeine before a lash set so you can relax', 'Remove contact lenses or bring your case'];
const BROW_PREP = ['No tweezing for 2–3 weeks before shaping', 'No retinol or exfoliating on the brow area for 3 days', 'Come with a clean brow area — no makeup'];
const LASH_CARE = [
  { step: 'Keep them dry for 24 hours', text: 'No water, steam or sweaty workouts while the adhesive cures.' },
  { step: 'Brush them every morning', text: 'Use your spoolie to keep them fluffy and in place.' },
  { step: 'Oil-free products only', text: 'Oils break down the bond — check your cleanser and remover.' },
  { step: 'Don’t pick or pull', text: 'Let them shed naturally; book a fill every 2–3 weeks.' }
];
const BROW_CARE = [
  { step: 'Keep them dry for 24 hours', text: 'No water, steam or makeup on the brows for a day.' },
  { step: 'Brush them up daily', text: 'A clean spoolie keeps lamination in shape.' },
  { step: 'Nourish', text: 'A drop of brow oil at night keeps the hair healthy after lamination.' },
  { step: 'Go easy on exfoliants', text: 'Retinol and acids near the brows make tint fade faster.' }
];

export const TEMPLATES: Record<string, Template> = {
  lashes: {
    label: 'Lashes', tagline: 'Lashes that wake up ready', services: LASH_SVCS,
    policies: [CANCEL, LATE, NOSHOW, { title: 'Sensitive eyes', text: 'New to extensions or sensitive? Ask for a patch test 48 hours before your first set.' }],
    faq: LASH_FAQ, prep: LASH_PREP, aftercare: LASH_CARE
  },
  brows: {
    label: 'Brows', tagline: 'Brows, shaped to you', services: BROW_SVCS,
    policies: [CANCEL, LATE, NOSHOW, { title: 'Patch test', text: 'New to tint or lamination? A patch test 48 hours before is recommended.' }],
    faq: BROW_FAQ, prep: BROW_PREP, aftercare: BROW_CARE
  },
  nails: {
    label: 'Nails', tagline: 'Nails that last', services: [
      { category: 'Nails', name: 'Classic Manicure', description: 'Shape, cuticle care, massage and regular polish.', duration_min: 30, buffer_min: 10, price: 30 },
      { category: 'Nails', name: 'Gel Manicure', description: 'Chip-free shine for 2–3 weeks, cured under LED.', duration_min: 45, buffer_min: 10, price: 45, fill_weeks: 3 },
      { category: 'Nails', name: 'Gel-X Full Set', description: 'Soft-gel extensions — light, strong and natural-looking.', duration_min: 90, buffer_min: 15, price: 75, fill_weeks: 3 },
      { category: 'Nails', name: 'Acrylic Full Set', description: 'Classic acrylic extensions in your length and shape.', duration_min: 90, buffer_min: 15, price: 65, fill_weeks: 3 },
      { category: 'Nails', name: 'Acrylic Fill', description: 'Fill for our own sets within 3 weeks.', duration_min: 60, buffer_min: 10, price: 50, fill_weeks: 3 },
      { category: 'Nails', name: 'Gel Pedicure', description: 'Soak, scrub, cuticle care and gel polish that lasts.', duration_min: 60, buffer_min: 10, price: 60 },
      { category: 'Nails', name: 'Nail Art', description: 'Designs, chrome or charms — priced by detail.', duration_min: 15, buffer_min: 0, price: 15, price_from: true }
    ],
    policies: [CANCEL, LATE, NOSHOW, { title: 'Fills', text: 'Fills are for our own work within 3 weeks; sets from another salon are booked as a removal + new set.' }],
    faq: [
      { q: 'How long does a gel manicure last?', a: 'Two to three weeks without chips with normal wear.', keywords: ['gel', 'last', 'long', 'chip'] },
      { q: 'Gel-X or acrylic?', a: 'Gel-X is lighter and more flexible; acrylic is the strongest for long shapes. Ask at your visit and we’ll pick together.', keywords: ['gel-x', 'gelx', 'acrylic', 'difference', 'which'] },
      { q: 'Do you remove gel from another salon?', a: 'Yes — add about 15 minutes and mention it in the note when you book.', keywords: ['remove', 'removal', 'soak', 'another salon'] },
      { q: 'Can I bring a photo of the design I want?', a: 'Please do! Detailed art is priced by detail and time.', keywords: ['photo', 'design', 'art', 'picture'] }
    ],
    prep: ['Come with clean, polish-free nails if you can (or book removal)', 'Bring a photo of the shape or design you love', 'Skip lotion on your hands the morning of your visit'],
    aftercare: [
      { step: 'Use cuticle oil daily', text: 'It keeps the product flexible and your nails healthy.' },
      { step: 'Nails aren’t tools', text: 'Don’t pry or scrape with them — use the pads of your fingers.' },
      { step: 'Gloves for chores', text: 'Hot water and cleaners shorten the life of any set.' },
      { step: 'Book your fill on time', text: 'Every 2–3 weeks keeps them strong and balanced.' }
    ]
  },
  'lashes-brows': {
    label: 'Lashes + Brows', tagline: 'Lashes & brows, beautifully done',
    services: [LASH_SVCS[0], LASH_SVCS[1], LASH_SVCS[3], LASH_SVCS[4], BROW_SVCS[1], BROW_SVCS[3]],
    policies: [CANCEL, LATE, NOSHOW, { title: 'Patch test', text: 'New to extensions, tint or lamination? Ask for a patch test 48 hours before.' }],
    faq: [LASH_FAQ[0], LASH_FAQ[1], LASH_FAQ[2], BROW_FAQ[0], BROW_FAQ[1]],
    prep: [LASH_PREP[0], BROW_PREP[0], LASH_PREP[2]],
    aftercare: [LASH_CARE[0], LASH_CARE[1], LASH_CARE[2], BROW_CARE[1]]
  },
  hair: {
    label: 'Hair', tagline: 'Hair you’ll love', services: [
      { category: 'Hair', name: 'Haircut & Style', description: 'Consultation, wash, cut and a finished style.', duration_min: 60, buffer_min: 15, price: 75, price_from: true },
      { category: 'Hair', name: 'Blowout', description: 'Wash and a smooth, bouncy blowout.', duration_min: 45, buffer_min: 10, price: 50 },
      { category: 'Hair', name: 'Single-Process Color', description: 'All-over color from roots to ends.', duration_min: 120, buffer_min: 15, price: 120, price_from: true, fill_weeks: 6 },
      { category: 'Hair', name: 'Root Touch-Up', description: 'Color for regrowth up to 1.5 inches.', duration_min: 90, buffer_min: 15, price: 95, fill_weeks: 6 },
      { category: 'Hair', name: 'Balayage', description: 'Hand-painted, soft dimension that grows out beautifully.', duration_min: 180, buffer_min: 15, price: 250, price_from: true, fill_weeks: 12 },
      { category: 'Hair', name: 'Gloss / Toner', description: 'Refreshes tone and adds shine between color visits.', duration_min: 45, buffer_min: 10, price: 60 },
      { category: 'Hair', name: 'Silk Press', description: 'Wash, deep condition and a sleek silk press.', duration_min: 120, buffer_min: 15, price: 95, price_from: true }
    ],
    policies: [CANCEL, LATE, NOSHOW, { title: 'Color', text: 'Big color changes start with a quick consultation; the final price depends on hair length and density — confirmed before we start.' }],
    faq: [
      { q: 'Do I need a consultation for color?', a: 'For a big change, yes — it’s quick and makes sure we plan the right service and time.', keywords: ['consultation', 'consult', 'color change'] },
      { q: 'Why does the price say “from”?', a: 'Length and density change the time and product needed — we confirm the price at the chair before starting.', keywords: ['from', 'price', 'cost', 'how much'] },
      { q: 'How long does balayage take?', a: 'Usually about 3 hours, depending on your hair and the look you want.', keywords: ['balayage', 'how long', 'time'] },
      { q: 'Should I come with clean hair?', a: 'For color, hair washed 1–2 days before is ideal. For cuts, come as you are.', keywords: ['clean', 'wash', 'dirty'] }
    ],
    prep: ['Bring photos of the looks you love (and don’t)', 'For color: wash your hair 1–2 days before', 'Tell us about any recent color or treatments'],
    aftercare: [
      { step: 'Wait 48 hours to wash', text: 'After color, give it two days to settle.' },
      { step: 'Sulfate-free shampoo', text: 'It keeps color and smoothness longer.' },
      { step: 'Heat protectant, always', text: 'Use it before every blow-dry or iron.' },
      { step: 'Book your next visit', text: 'Trims every 8–10 weeks; root touch-ups every 5–6.' }
    ]
  },
  makeup: {
    label: 'Makeup', tagline: 'Makeup for your moments', services: [
      { category: 'Makeup', name: 'Soft Glam', description: 'Fresh, polished makeup that still looks like you.', duration_min: 60, buffer_min: 15, price: 95 },
      { category: 'Makeup', name: 'Full Glam', description: 'Sculpted, long-wear glam for photos and events.', duration_min: 75, buffer_min: 15, price: 120 },
      { category: 'Makeup', name: 'Bridal Makeup', description: 'Long-wear bridal makeup on your day, timed to your schedule.', duration_min: 90, buffer_min: 15, price: 250, price_from: true },
      { category: 'Makeup', name: 'Bridal Trial', description: 'We design your wedding look together before the big day.', duration_min: 75, buffer_min: 15, price: 150 },
      { category: 'Makeup', name: 'Makeup Lesson (1:1)', description: 'Learn an everyday look with your own products.', duration_min: 90, buffer_min: 15, price: 150 },
      { category: 'Makeup', name: 'Strip Lashes', description: 'Add lashes to any makeup service.', duration_min: 15, buffer_min: 0, price: 15 }
    ],
    policies: [CANCEL, LATE, NOSHOW, { title: 'Travel', text: 'On-location makeup is available for events — ask about the travel fee.' }],
    faq: [
      { q: 'How long will my makeup last?', a: 'All day — we prep your skin and set everything for long wear.', keywords: ['last', 'long', 'wear'] },
      { q: 'Do you do bridal trials?', a: 'Yes — book a Bridal Trial 1–3 months before the wedding.', keywords: ['bridal', 'trial', 'wedding'] },
      { q: 'Do you travel to events?', a: 'Yes, for events and weddings — message us with the date and place.', keywords: ['travel', 'location', 'come to', 'on site'] },
      { q: 'Are lashes included?', a: 'Strip lashes can be added to any service.', keywords: ['lashes', 'strip', 'included'] }
    ],
    prep: ['Come with a clean, moisturized face', 'Bring photos of looks you love', 'Wear a top that opens in the front'],
    aftercare: [
      { step: 'Blot, don’t rub', text: 'Use blotting papers for shine during the day.' },
      { step: 'Touch up lips', text: 'Keep your lip color with you for after meals.' },
      { step: 'Remove gently', text: 'Use an oil cleanser at night, then your usual skincare.' }
    ]
  }
};
