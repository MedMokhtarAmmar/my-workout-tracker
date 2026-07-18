// Seeds the database with the built-in plans. Safe to run multiple times:
// each plan is skipped individually once its key already exists, so adding
// a new plan here later will seed just that plan into an existing database.

const UPPER_LOWER_PLAN = {
  key: 'upper_lower',
  name: 'Upper/Lower 4-Day Split',
  description: 'A classic 4-day split alternating upper and lower body days.',
  templates: [
    {
      key: 'upper_a',
      name: 'Upper A',
      focus: 'Strength Focus',
      exercises: [
        { name: 'Chest Press Machine', sets: 3, low: 8, high: 10, rest: 105 },
        { name: 'Lat Pulldown', sets: 3, low: 8, high: 10, rest: 105 },
        { name: 'Seated Cable Row', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Seated Dumbbell Shoulder Press', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Dumbbell Lateral Raise', sets: 2, low: 12, high: 15, rest: 50, notes: 'Use light weights.' },
        { name: 'Rope Triceps Pushdown', sets: 2, low: 12, high: 15, rest: 50 },
        { name: 'Dumbbell Bicep Curl', sets: 2, low: 12, high: 15, rest: 50 },
        { name: 'Plank', sets: 3, low: 30, high: 45, rest: 40, notes: 'Reps = seconds held.' },
      ],
    },
    {
      key: 'lower_a',
      name: 'Lower A',
      focus: '',
      exercises: [
        { name: 'Leg Press', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Romanian Deadlift (Dumbbells)', sets: 3, low: 10, high: 10, rest: 105, notes: 'Focus on learning the hip hinge.' },
        { name: 'Leg Curl Machine', sets: 3, low: 12, high: 12, rest: 50 },
        { name: 'Leg Extension', sets: 2, low: 12, high: 12, rest: 50 },
        { name: 'Standing Calf Raise', sets: 3, low: 15, high: 15, rest: 50 },
        { name: 'Hanging Knee Raise (or Reverse Crunch)', sets: 3, low: 12, high: 12, rest: 40 },
      ],
    },
    {
      key: 'upper_b',
      name: 'Upper B',
      focus: 'Hypertrophy Focus',
      exercises: [
        { name: 'Incline Dumbbell Press', sets: 3, low: 10, high: 12, rest: 105 },
        { name: 'Assisted Pull-Up Machine (or Lat Pulldown)', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Chest Supported Row Machine', sets: 3, low: 10, high: 12, rest: 105 },
        { name: 'Machine Shoulder Press', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Face Pull', sets: 2, low: 15, high: 15, rest: 50, notes: 'Excellent for posture, especially with a desk job.' },
        { name: 'Hammer Curl', sets: 2, low: 12, high: 12, rest: 50 },
        { name: 'Overhead Rope Triceps Extension', sets: 2, low: 12, high: 12, rest: 50 },
        { name: 'Cable Crunch', sets: 3, low: 15, high: 15, rest: 40 },
      ],
    },
    {
      key: 'lower_b',
      name: 'Lower B',
      focus: '',
      exercises: [
        { name: 'Goblet Squat', sets: 3, low: 10, high: 10, rest: 105, notes: "Once you're comfortable, switch to barbell squats." },
        { name: 'Walking Lunges', sets: 2, low: 10, high: 10, rest: 105, notes: 'Reps = each leg.' },
        { name: 'Hip Thrust Machine (or Glute Bridge)', sets: 3, low: 12, high: 12, rest: 105 },
        { name: 'Seated Leg Curl', sets: 3, low: 12, high: 12, rest: 50 },
        { name: 'Standing Calf Raise', sets: 3, low: 15, high: 15, rest: 50 },
        { name: 'Cable Woodchoppers', sets: 3, low: 12, high: 12, rest: 50, notes: 'Reps = each side.' },
      ],
    },
  ],
};

const PPL_PLAN = {
  key: 'ppl',
  name: 'Push Pull Legs (PPL)',
  description: 'Run it as a 6-day week (Push/Pull/Legs/Rest/Push/Pull/Legs) or a 5-day rotating cycle — just continue where you left off the following week. After each workout: 15–20 min incline treadmill walk. On rest days: 45–60 min brisk walk. Aim for 8,000–10,000 steps/day.',
  templates: [
    {
      key: 'push',
      name: 'Push',
      focus: 'Chest, Shoulders, Triceps',
      exercises: [
        { name: 'Incline Dumbbell Press', sets: 4, low: 8, high: 10, rest: 105, notes: 'This should be your main chest exercise.' },
        { name: 'Chest Press Machine', sets: 3, low: 10, high: 12, rest: 105 },
        { name: 'Seated Dumbbell Shoulder Press', sets: 3, low: 8, high: 10, rest: 105 },
        { name: 'Cable Lateral Raise', sets: 3, low: 12, high: 15, rest: 50, notes: 'Keep strict form.' },
        { name: 'Pec Deck / Machine Fly', sets: 2, low: 12, high: 15, rest: 50, notes: 'Slow stretch and squeeze.' },
        { name: 'Rope Triceps Pushdown', sets: 3, low: 10, high: 12, rest: 50 },
        { name: 'Overhead Rope Triceps Extension', sets: 2, low: 12, high: 15, rest: 50, notes: 'Targets the long head of the triceps.' },
      ],
    },
    {
      key: 'pull',
      name: 'Pull',
      focus: 'Back, Rear Delts, Biceps',
      exercises: [
        { name: 'Lat Pulldown', sets: 4, low: 8, high: 10, rest: 105 },
        { name: 'Chest Supported Row Machine', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Seated Cable Row', sets: 3, low: 10, high: 12, rest: 105 },
        { name: 'Face Pull', sets: 3, low: 12, high: 15, rest: 50, notes: 'Great for shoulder health and posture.' },
        { name: 'Rear Delt Machine Fly', sets: 2, low: 15, high: 15, rest: 50 },
        { name: 'Hammer Curl', sets: 3, low: 10, high: 12, rest: 50 },
        { name: 'EZ Bar Curl', sets: 2, low: 12, high: 12, rest: 50 },
        { name: 'Plank', sets: 3, low: 30, high: 45, rest: 40, notes: 'Reps = seconds held.' },
      ],
    },
    {
      key: 'legs',
      name: 'Legs',
      focus: '',
      exercises: [
        { name: 'Leg Press', sets: 4, low: 10, high: 10, rest: 105 },
        { name: 'Romanian Deadlift (Dumbbells)', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Walking Lunges', sets: 3, low: 10, high: 10, rest: 105, notes: 'Reps = each leg.' },
        { name: 'Leg Curl Machine', sets: 3, low: 12, high: 12, rest: 50 },
        { name: 'Leg Extension', sets: 3, low: 12, high: 12, rest: 50 },
        { name: 'Standing Calf Raise', sets: 4, low: 15, high: 15, rest: 50 },
        { name: 'Hanging Knee Raise (or Reverse Crunch)', sets: 3, low: 12, high: 12, rest: 40 },
      ],
    },
  ],
};

const BODY_PART_SPLIT_PLAN = {
  key: 'body_part_split',
  name: 'Chest+Back / Shoulders+Arms / Legs+Abs Split',
  description: 'Run each day twice a week (Mon/Thu Chest+Back, Tue/Fri Shoulders+Arms, Wed/Sat Legs+Abs), with Sunday or a mid-week day as rest or a 45 min walk. Use double progression and keep 1–2 reps in reserve on most sets.',
  templates: [
    {
      key: 'chest_back',
      name: 'Chest + Back',
      focus: '',
      exercises: [
        { name: 'Incline Dumbbell Press', sets: 4, low: 8, high: 10, rest: 105 },
        { name: 'Chest Press Machine', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Pec Deck / Machine Fly', sets: 3, low: 12, high: 15, rest: 50 },
        { name: 'Lat Pulldown', sets: 4, low: 8, high: 10, rest: 105 },
        { name: 'Chest Supported Row Machine', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Seated Cable Row', sets: 3, low: 10, high: 12, rest: 105 },
        { name: 'Straight Arm Pulldown', sets: 2, low: 12, high: 15, rest: 50 },
      ],
    },
    {
      key: 'shoulders_arms',
      name: 'Shoulders + Arms',
      focus: '',
      exercises: [
        { name: 'Seated Dumbbell Shoulder Press', sets: 4, low: 8, high: 10, rest: 105 },
        { name: 'Dumbbell Lateral Raise', sets: 3, low: 12, high: 15, rest: 50 },
        { name: 'Face Pull', sets: 3, low: 12, high: 15, rest: 50 },
        { name: 'Rear Delt Machine Fly', sets: 2, low: 15, high: 15, rest: 50 },
        { name: 'Dumbbell Bicep Curl', sets: 3, low: 10, high: 10, rest: 50 },
        { name: 'Hammer Curl', sets: 3, low: 10, high: 12, rest: 50 },
        { name: 'Rope Triceps Pushdown', sets: 3, low: 10, high: 10, rest: 50 },
        { name: 'Overhead Rope Triceps Extension', sets: 3, low: 12, high: 12, rest: 50 },
      ],
    },
    {
      key: 'legs_abs',
      name: 'Legs + Abs',
      focus: '',
      exercises: [
        { name: 'Leg Press', sets: 4, low: 10, high: 10, rest: 105 },
        { name: 'Romanian Deadlift (Dumbbells)', sets: 3, low: 10, high: 10, rest: 105 },
        { name: 'Walking Lunges', sets: 3, low: 10, high: 10, rest: 105, notes: 'Reps = each leg.' },
        { name: 'Leg Curl Machine', sets: 3, low: 12, high: 12, rest: 50 },
        { name: 'Leg Extension', sets: 3, low: 12, high: 12, rest: 50 },
        { name: 'Standing Calf Raise', sets: 4, low: 15, high: 15, rest: 50 },
        { name: 'Hanging Knee Raise (or Reverse Crunch)', sets: 3, low: 12, high: 12, rest: 40 },
        { name: 'Cable Crunch', sets: 3, low: 15, high: 15, rest: 40 },
      ],
    },
  ],
};

const PLANS = [UPPER_LOWER_PLAN, PPL_PLAN, BODY_PART_SPLIT_PLAN];

// Equipment type per exercise, used to pick an icon in the UI.
// One of: 'machine', 'cable', 'dumbbell', 'barbell', 'bodyweight'
const EQUIPMENT = {
  'Chest Press Machine': 'machine',
  'Lat Pulldown': 'cable',
  'Seated Cable Row': 'cable',
  'Seated Dumbbell Shoulder Press': 'dumbbell',
  'Dumbbell Lateral Raise': 'dumbbell',
  'Rope Triceps Pushdown': 'cable',
  'Dumbbell Bicep Curl': 'dumbbell',
  'Plank': 'bodyweight',
  'Leg Press': 'machine',
  'Romanian Deadlift (Dumbbells)': 'dumbbell',
  'Leg Curl Machine': 'machine',
  'Leg Extension': 'machine',
  'Standing Calf Raise': 'machine',
  'Hanging Knee Raise (or Reverse Crunch)': 'bodyweight',
  'Incline Dumbbell Press': 'dumbbell',
  'Assisted Pull-Up Machine (or Lat Pulldown)': 'machine',
  'Chest Supported Row Machine': 'machine',
  'Machine Shoulder Press': 'machine',
  'Face Pull': 'cable',
  'Hammer Curl': 'dumbbell',
  'Overhead Rope Triceps Extension': 'cable',
  'Cable Crunch': 'cable',
  'Goblet Squat': 'dumbbell',
  'Walking Lunges': 'dumbbell',
  'Hip Thrust Machine (or Glute Bridge)': 'machine',
  'Seated Leg Curl': 'machine',
  'Cable Woodchoppers': 'cable',
  'Cable Lateral Raise': 'cable',
  'Pec Deck / Machine Fly': 'machine',
  'Rear Delt Machine Fly': 'machine',
  'EZ Bar Curl': 'barbell',
  'Straight Arm Pulldown': 'cable',
};

// Backfills the equipment category for exercises inserted before this
// column was used, or on a fresh seed. Safe to run every startup.
function categorizeExercises(db) {
  const update = db.prepare('UPDATE exercises SET category = ? WHERE name = ? AND (category IS NULL OR category = ?)');
  db.exec('BEGIN');
  try {
    for (const [name, category] of Object.entries(EQUIPMENT)) {
      update.run(category, name, '');
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Reference photo + "how to" video for machine exercises, sourced from
// myworkout-tracker-images/machine and tutorial-machine-links.md.
const EXERCISE_MEDIA = {
  'Assisted Pull-Up Machine (or Lat Pulldown)': {
    image: '/exercise-media/sp500-lat-pulldown-7-1.webp',
    video: 'https://www.youtube.com/watch?v=6mKidNXXeQc',
  },
  // Same reference photo as the machine above — the plain "Lat Pulldown"
  // exercise (cable category) is a distinct row, used in the other plans.
  // Video is its own dedicated tutorial from tutorials.md.
  'Lat Pulldown': {
    image: '/exercise-media/sp500-lat-pulldown-7-1.webp',
    video: 'https://www.youtube.com/shorts/hnSqbBk15tw',
  },
  'Chest Press Machine': {
    image: '/exercise-media/chest-press-machine.png',
    video: 'https://www.youtube.com/watch?v=vnd-GBtTMLI',
  },
  'Chest Supported Row Machine': {
    image: '/exercise-media/chest_supported_row_machine-4.webp',
    video: 'https://www.youtube.com/watch?v=bmWA2yO9Aa0',
  },
  'Hip Thrust Machine (or Glute Bridge)': {
    image: '/exercise-media/hip-thrust-machine.webp',
    video: 'https://www.youtube.com/watch?v=xtIZ9pjcA_8',
  },
  'Leg Curl Machine': {
    image: '/exercise-media/leg-curl.webp',
    video: 'https://www.youtube.com/watch?v=MAbThtU8Sis',
  },
  'Leg Extension': {
    image: '/exercise-media/leg-extension-machine.png',
    video: 'https://www.youtube.com/watch?v=4ZDm5EbiFI8',
  },
  'Leg Press': {
    image: '/exercise-media/leg-press.webp',
    video: 'https://www.youtube.com/watch?v=q4W4_VJbKW0',
  },
  'Machine Shoulder Press': {
    image: '/exercise-media/machine-shoulder-press.webp',
    video: 'https://www.youtube.com/watch?v=WvLMauqrnK8',
  },
  'Pec Deck / Machine Fly': {
    image: '/exercise-media/pec-deck-fly.gif',
    video: 'https://www.youtube.com/watch?v=eGjt4lk6g34',
  },
  'Rear Delt Machine Fly': {
    image: '/exercise-media/rear-delt-machine-flys.gif',
    video: 'https://www.youtube.com/watch?v=Y59M5fXn8bs',
  },
  'Seated Leg Curl': {
    image: '/exercise-media/seated-leg-curl.jpg',
    video: 'https://www.youtube.com/watch?v=hhzTWndsgTc',
  },
  'Standing Calf Raise': {
    image: '/exercise-media/standing-calf-raise.jpg',
    video: 'https://www.youtube.com/watch?v=GAQ-oohMhog',
  },

  // Video-only tutorials from tutorials.md (no reference photos provided
  // for these — barbell/bodyweight/cable/dumbbell exercises).
  'EZ Bar Curl': { video: 'https://www.youtube.com/shorts/yXCFBwZ4LLU' },
  'Hanging Knee Raise (or Reverse Crunch)': { video: 'https://www.youtube.com/shorts/EVC9d9DaTa8' },
  'Plank': { video: 'https://www.youtube.com/shorts/xe2MXatLTUw' },
  'Cable Crunch': { video: 'https://www.youtube.com/shorts/dkGwcfo9zto' },
  'Cable Lateral Raise': { video: 'https://www.youtube.com/shorts/yHNBM_BTp_s' },
  'Cable Woodchoppers': { video: 'https://www.youtube.com/shorts/YIU0U_B57rU' },
  'Face Pull': { video: 'https://www.youtube.com/shorts/IeOqdw9WI90' },
  'Overhead Rope Triceps Extension': { video: 'https://www.youtube.com/shorts/9Ark9S11uXw' },
  'Rope Triceps Pushdown': { video: 'https://www.youtube.com/watch?v=-xa-6cQaZKY' },
  'Seated Cable Row': { video: 'https://www.youtube.com/shorts/qD1WZ5pSuvk' },
  'Straight Arm Pulldown': { video: 'https://www.youtube.com/shorts/hAMcfubonDc' },
  'Dumbbell Bicep Curl': { video: 'https://www.youtube.com/shorts/MKWBV29S6c0' },
  'Dumbbell Lateral Raise': { video: 'https://www.youtube.com/shorts/Kl3LEzQ5Zqs' },
  'Goblet Squat': { video: 'https://www.youtube.com/shorts/lRYBbchqxtI' },
  'Hammer Curl': { video: 'https://www.youtube.com/watch?v=BRVDS6HVR9Q' },
  'Incline Dumbbell Press': { video: 'https://www.youtube.com/shorts/8fXfwG4ftaQ' },
  'Romanian Deadlift (Dumbbells)': { video: 'https://www.youtube.com/shorts/hu3jRvTc_po' },
  'Seated Dumbbell Shoulder Press': { video: 'https://www.youtube.com/shorts/k6tzKisR3NY' },
  'Walking Lunges': { video: 'https://www.youtube.com/shorts/mJilHWIBWO8' },
};

// Backfills reference image/video for exercises matching EXERCISE_MEDIA by
// name. Each column is filled independently and only when still empty, so
// this stays safe to run every startup without clobbering existing data.
function attachExerciseMedia(db) {
  const updateImage = db.prepare('UPDATE exercises SET image_path = ? WHERE name = ? AND image_path IS NULL');
  const updateVideo = db.prepare('UPDATE exercises SET video_url = ? WHERE name = ? AND video_url IS NULL');
  db.exec('BEGIN');
  try {
    for (const [name, media] of Object.entries(EXERCISE_MEDIA)) {
      if (media.image) updateImage.run(media.image, name);
      if (media.video) updateVideo.run(media.video, name);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seed(db) {
  const findPlan = db.prepare('SELECT id FROM plans WHERE key = ?');
  const insertPlan = db.prepare('INSERT INTO plans (key, name, description) VALUES (?, ?, ?)');
  const insertExercise = db.prepare('INSERT INTO exercises (name, category) VALUES (?, ?)');
  const findExercise = db.prepare('SELECT id FROM exercises WHERE name = ?');
  const insertTemplate = db.prepare('INSERT INTO templates (key, name, focus, plan_id) VALUES (?, ?, ?, ?)');
  const insertTemplateExercise = db.prepare(`
    INSERT INTO template_exercises
      (template_id, exercise_id, order_index, target_sets, target_reps_low, target_reps_high, rest_seconds, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const plan of PLANS) {
    if (findPlan.get(plan.key)) continue; // already seeded

    db.exec('BEGIN');
    try {
      const planId = insertPlan.run(plan.key, plan.name, plan.description).lastInsertRowid;

      for (const day of plan.templates) {
        const templateId = insertTemplate.run(day.key, day.name, day.focus, planId).lastInsertRowid;

        day.exercises.forEach((ex, idx) => {
          let exerciseId;
          const existing = findExercise.get(ex.name);
          if (existing) {
            exerciseId = existing.id;
          } else {
            exerciseId = insertExercise.run(ex.name, null).lastInsertRowid;
          }
          insertTemplateExercise.run(
            templateId,
            exerciseId,
            idx,
            ex.sets,
            ex.low,
            ex.high,
            ex.rest || null,
            ex.notes || null
          );
        });
      }
      db.exec('COMMIT');
      console.log(`Seeded plan: ${plan.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

module.exports = { seed, categorizeExercises, attachExerciseMedia, PLANS };
