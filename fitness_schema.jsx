import { useState, useEffect, useRef } from "react";
import { supabase } from "./src/supabase.js";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Haptics, ImpactStyle } from "@capacitor/haptics";

const schema = {
  days: [
    { id: 4, name: "Schouders", emoji: "🪨", color: "#e9c46a" },
    { id: 2, name: "Borst & Triceps", emoji: "💪", color: "#457b9d" },
    { id: 3, name: "Rug & Biceps", emoji: "🏋️", color: "#7c3aed" },
    { id: 1, name: "Benen & Billen", emoji: "🦵", color: "#e63946" },
  ],
  weeks: [
    // WEEK 1-3: Zelfde oefeningen, progressieve overload
    {
      week: 1,
      label: "Week 23",
      phase: "Opbouw",
      days: [
        {
          dayId: 4,
          spiergroep: [
            { name: "Dumbbell Lateral Raise", sets: "4x12", note: "" },
            { name: "Face Pull (cable)", sets: "3x15", note: "" },
            { name: "Dumbbell Front Raise", sets: "3x12", note: "" },
            { name: "Cable Shrug", sets: "3x15", note: "" },
            { name: "Arnold Press", sets: "3x10", note: "", optional: true },
          ],
          barbell: { name: "Barbell Overhead Press", sets: "4x8", note: "Focusgewicht" },
          kettlebell: [
            { name: "KB Halo", sets: "3x10", note: "Full body" },
            { name: "KB Clean & Press", sets: "3x8/arm", note: "Full body" },
            { name: "KB Around the World", sets: "3x10", note: "Full body" },
          ],
          core: [
            { name: "Plank", sets: "3x60sec", note: "" },
            { name: "Bicycle Crunch", sets: "3x20", note: "" },
            { name: "Pallof Press", sets: "3x12", note: "" },
          ],
        },
        {
          dayId: 2,
          spiergroep: [
            { name: "Incline Dumbbell Press", sets: "4x10", note: "" },
            { name: "Cable Fly", sets: "3x12", note: "" },
            { name: "Tricep Pushdown", sets: "3x12", note: "" },
            { name: "Skull Crusher", sets: "3x12", note: "" },
            { name: "Chest Dip", sets: "3x10", note: "", optional: true },
          ],
          barbell: { name: "Barbell Bench Press", sets: "4x8", note: "Focusgewicht" },
          kettlebell: [
            { name: "KB Clean & Press", sets: "3x10", note: "Full body" },
            { name: "KB Farmer's Carry", sets: "3x20m", note: "Full body" },
            { name: "KB Swing", sets: "3x10", note: "Full body" },
          ],
          core: [
            { name: "Ab Wheel Rollout", sets: "3x10", note: "" },
            { name: "Russian Twist", sets: "3x20", note: "" },
            { name: "Plank Shoulder Tap", sets: "3x20", note: "" },
          ],
        },
        {
          dayId: 3,
          spiergroep: [
            { name: "Seated Cable Row", sets: "4x10", note: "" },
            { name: "Lat Pulldown", sets: "3x12", note: "" },
            { name: "Dumbbell Curl", sets: "3x12", note: "" },
            { name: "Concentration Curl", sets: "3x12", note: "" },
            { name: "Straight Arm Pulldown", sets: "3x12", note: "", optional: true },
          ],
          barbell: { name: "Barbell Deadlift", sets: "4x6", note: "Focusgewicht" },
          kettlebell: [
            { name: "KB Wood Chop", sets: "3x10/arm", note: "Full body" },
            { name: "KB Swing", sets: "3x15", note: "Full body" },
            { name: "KB Alternating March", sets: "3x5/arm", note: "Full body" },
          ],
          core: [
            { name: "Hanging Leg Raise", sets: "3x12", note: "" },
            { name: "Cable Crunch", sets: "3x15", note: "" },
            { name: "Side Plank", sets: "3x30sec/zij", note: "" },
          ],
        },
        {
          dayId: 1,
          spiergroep: [
            { name: "Leg Press", sets: "4x10", note: "" },
            { name: "Barbell Romanian Deadlift", sets: "3x12", note: "" },
            { name: "Leg Curl Machine", sets: "3x12", note: "" },
            { name: "Leg Extension Machine", sets: "3x12", note: "" },
            { name: "Standing Calf Raise", sets: "4x15", note: "", optional: true },
          ],
          barbell: { name: "Barbell Back Squat", sets: "4x8", note: "Focusgwicht" },
          kettlebell: [
            { name: "KB Swing", sets: "3x15", note: "Full body explosief" },
            { name: "KB Lateral Lunge", sets: "3x12", note: "Full body" },
            { name: "KB Sumo Deadlift", sets: "3x12", note: "Full body" },
          ],
          core: [
            { name: "Plank", sets: "3x45sec", note: "" },
            { name: "Leg Raises", sets: "3x15", note: "" },
            { name: "Dead Bug", sets: "3x10", note: "" },
          ],
        },
      ],
    },
    {
      week: 2,
      label: "Week 24",
      phase: "Opbouw",
      days: [
        {
          dayId: 4,
          spiergroep: [
            { name: "Dumbbell Lateral Raise", sets: "4x12", note: "+gewicht" },
            { name: "Face Pull (cable)", sets: "4x15", note: "+gewicht" },
            { name: "Dumbbell Front Raise", sets: "4x12", note: "+gewicht" },
            { name: "Cable Shrug", sets: "4x15", note: "+gewicht" },
            { name: "Arnold Press", sets: "4x10", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Overhead Press", sets: "4x8", note: "+5kg" },
          kettlebell: [
            { name: "KB Halo", sets: "4x10", note: "+gewicht" },
            { name: "KB Clean & Press", sets: "3x8/arm", note: "+gewicht" },
            { name: "KB Around the World", sets: "3x12", note: "+gewicht" },
          ],
          core: [
            { name: "Plank", sets: "3x75sec", note: "" },
            { name: "Bicycle Crunch", sets: "3x24", note: "" },
            { name: "Pallof Press", sets: "3x15", note: "" },
          ],
        },
        {
          dayId: 2,
          spiergroep: [
            { name: "Incline Dumbbell Press", sets: "4x10", note: "+gewicht" },
            { name: "Cable Fly", sets: "4x12", note: "+gewicht" },
            { name: "Tricep Pushdown", sets: "4x12", note: "+gewicht" },
            { name: "Skull Crusher", sets: "4x12", note: "+gewicht" },
            { name: "Chest Dip", sets: "3x10", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Bench Press", sets: "4x8", note: "+5kg" },
          kettlebell: [
            { name: "KB Clean & Press", sets: "4x10", note: "+gewicht" },
            { name: "KB Farmer's Carry", sets: "3x20m", note: "+gewicht" },
            { name: "KB Swing", sets: "3x10", note: "+gewicht" },
          ],
          core: [
            { name: "Ab Wheel Rollout", sets: "3x12", note: "" },
            { name: "Russian Twist", sets: "3x24", note: "" },
            { name: "Plank Shoulder Tap", sets: "3x24", note: "" },
          ],
        },
        {
          dayId: 3,
          spiergroep: [
            { name: "Seated Cable Row", sets: "4x10", note: "+gewicht" },
            { name: "Lat Pulldown", sets: "4x12", note: "+gewicht" },
            { name: "Dumbbell Curl", sets: "4x12", note: "+gewicht" },
            { name: "Concentration Curl", sets: "4x12", note: "+gewicht" },
            { name: "Straight Arm Pulldown", sets: "3x12", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Deadlift", sets: "4x6", note: "+5kg" },
          kettlebell: [
            { name: "KB Wood Chop", sets: "4x10/arm", note: "+gewicht" },
            { name: "KB Swing", sets: "4x15", note: "+gewicht" },
            { name: "KB Alternating March", sets: "3x5/arm", note: "+gewicht" },
          ],
          core: [
            { name: "Hanging Leg Raise", sets: "3x15", note: "" },
            { name: "Cable Crunch", sets: "3x18", note: "" },
            { name: "Side Plank", sets: "3x40sec/zij", note: "" },
          ],
        },
        {
          dayId: 1,
          spiergroep: [
            { name: "Leg Press", sets: "4x10", note: "+gewicht" },
            { name: "Barbell Romanian Deadlift", sets: "4x12", note: "+gewicht" },
            { name: "Leg Curl Machine", sets: "4x12", note: "+gewicht" },
            { name: "Leg Extension Machine", sets: "4x12", note: "+gewicht" },
            { name: "Standing Calf Raise", sets: "4x15", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Back Squat", sets: "4x8", note: "+5kg" },
          kettlebell: [
            { name: "KB Swing", sets: "4x15", note: "+gewicht" },
            { name: "KB Lateral Lunge", sets: "3x12", note: "+gewicht" },
            { name: "KB Sumo Deadlift", sets: "3x12", note: "+gewicht" },
          ],
          core: [
            { name: "Plank", sets: "3x60sec", note: "" },
            { name: "Leg Raises", sets: "3x18", note: "" },
            { name: "Dead Bug", sets: "3x12", note: "" },
          ],
        },
      ],
    },
    {
      week: 3,
      label: "Week 25",
      phase: "Opbouw",
      days: [
        {
          dayId: 4,
          spiergroep: [
            { name: "Dumbbell Lateral Raise", sets: "5x12", note: "+gewicht" },
            { name: "Face Pull (cable)", sets: "4x15", note: "+gewicht" },
            { name: "Dumbbell Front Raise", sets: "4x12", note: "+gewicht" },
            { name: "Cable Shrug", sets: "4x15", note: "+gewicht" },
            { name: "Arnold Press", sets: "4x10", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Overhead Press", sets: "5x6", note: "+5kg piek" },
          kettlebell: [
            { name: "KB Halo", sets: "4x10", note: "+gewicht" },
            { name: "KB Clean & Press", sets: "4x8/arm", note: "+gewicht" },
            { name: "KB Around the World", sets: "4x12", note: "+gewicht" },
          ],
          core: [
            { name: "Plank", sets: "3x90sec", note: "" },
            { name: "Bicycle Crunch", sets: "4x24", note: "" },
            { name: "Pallof Press", sets: "4x15", note: "" },
          ],
        },
        {
          dayId: 2,
          spiergroep: [
            { name: "Incline Dumbbell Press", sets: "5x10", note: "+gewicht" },
            { name: "Cable Fly", sets: "4x12", note: "+gewicht" },
            { name: "Tricep Pushdown", sets: "4x12", note: "+gewicht" },
            { name: "Skull Crusher", sets: "4x12", note: "+gewicht" },
            { name: "Chest Dip", sets: "4x10", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Bench Press", sets: "5x6", note: "+5kg piek" },
          kettlebell: [
            { name: "KB Clean & Press", sets: "4x10", note: "+gewicht" },
            { name: "KB Farmer's Carry", sets: "4x20m", note: "+gewicht" },
            { name: "KB Swing", sets: "4x10", note: "+gewicht" },
          ],
          core: [
            { name: "Ab Wheel Rollout", sets: "4x12", note: "" },
            { name: "Russian Twist", sets: "4x24", note: "" },
            { name: "Plank Shoulder Tap", sets: "4x24", note: "" },
          ],
        },
        {
          dayId: 3,
          spiergroep: [
            { name: "Seated Cable Row", sets: "5x10", note: "+gewicht" },
            { name: "Lat Pulldown", sets: "4x12", note: "+gewicht" },
            { name: "Dumbbell Curl", sets: "4x12", note: "+gewicht" },
            { name: "Concentration Curl", sets: "4x12", note: "+gewicht" },
            { name: "Straight Arm Pulldown", sets: "4x12", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Deadlift", sets: "5x5", note: "+5kg piek" },
          kettlebell: [
            { name: "KB Wood Chop", sets: "4x10/arm", note: "+gewicht" },
            { name: "KB Swing", sets: "4x20", note: "+gewicht" },
            { name: "KB Alternating March", sets: "4x5/arm", note: "+gewicht" },
          ],
          core: [
            { name: "Hanging Leg Raise", sets: "4x15", note: "" },
            { name: "Cable Crunch", sets: "4x18", note: "" },
            { name: "Side Plank", sets: "3x50sec/zij", note: "" },
          ],
        },
        {
          dayId: 1,
          spiergroep: [
            { name: "Leg Press", sets: "5x10", note: "+gewicht" },
            { name: "Barbell Romanian Deadlift", sets: "4x12", note: "+gewicht" },
            { name: "Leg Curl Machine", sets: "4x12", note: "+gewicht" },
            { name: "Leg Extension Machine", sets: "4x12", note: "+gewicht" },
            { name: "Standing Calf Raise", sets: "4x15", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Back Squat", sets: "5x6", note: "+5kg piek" },
          kettlebell: [
            { name: "KB Swing", sets: "4x20", note: "Max explosief" },
            { name: "KB Lateral Lunge", sets: "4x12", note: "+gewicht" },
            { name: "KB Sumo Deadlift", sets: "4x12", note: "+gewicht" },
          ],
          core: [
            { name: "Plank", sets: "3x75sec", note: "" },
            { name: "Leg Raises", sets: "4x18", note: "" },
            { name: "Dead Bug", sets: "3x14", note: "" },
          ],
        },
      ],
    },
    // WEEK 4-5: Nieuwe oefeningen, meer volume
    {
      week: 4,
      label: "Week 26",
      phase: "Nieuwe Prikkel",
      days: [
        {
          dayId: 4,
          spiergroep: [
            { name: "Cable Lateral Raise", sets: "4x15", note: "Nieuw" },
            { name: "Reverse Fly (pec deck)", sets: "4x15", note: "Nieuw" },
            { name: "Barbell Upright Row", sets: "4x10", note: "Nieuw" },
            { name: "Dumbbell Front Raise", sets: "4x12", note: "Nieuw" },
            { name: "Arnold Press", sets: "3x10", note: "Nieuw", optional: true },
          ],
          barbell: { name: "Barbell Push Press", sets: "4x6", note: "Nieuw explosief" },
          kettlebell: [
            { name: "KB Bottoms-Up Press", sets: "4x8/arm", note: "Full body stabiel" },
            { name: "KB Snatch", sets: "3x8/arm", note: "Full body" },
            { name: "KB Figure 8", sets: "3x12", note: "Full body" },
          ],
          core: [
            { name: "Landmine Rotation", sets: "3x12", note: "" },
            { name: "Stir the Pot (bosu/ball)", sets: "3x30sec", note: "" },
            { name: "Cable Woodchop", sets: "3x12/zij", note: "" },
          ],
        },
        {
          dayId: 2,
          spiergroep: [
            { name: "Decline Dumbbell Press", sets: "4x10", note: "Nieuw" },
            { name: "Pec Deck Machine", sets: "4x12", note: "Nieuw" },
            { name: "Overhead Tricep Extension", sets: "4x12", note: "Nieuw" },
            { name: "Cable Tricep Kickback", sets: "4x12", note: "Nieuw" },
            { name: "Chest Dip", sets: "3x10", note: "Nieuw", optional: true },
          ],
          barbell: { name: "Barbell Close Grip Bench Press", sets: "4x8", note: "Nieuw patroon" },
          kettlebell: [
            { name: "KB Floor Press", sets: "4x10", note: "Full body stabiel" },
            { name: "KB Windmill", sets: "3x8/arm", note: "Full body" },
            { name: "KB Single Arm Swing", sets: "3x12/arm", note: "Full body" },
          ],
          core: [
            { name: "Hollow Body Hold", sets: "3x40sec", note: "" },
            { name: "TRX/Ring Fallout", sets: "3x10", note: "" },
            { name: "Weighted Sit-Up", sets: "3x15", note: "" },
          ],
        },
        {
          dayId: 3,
          spiergroep: [
            { name: "T-Bar Row", sets: "4x10", note: "Nieuw" },
            { name: "Wide Grip Pulldown", sets: "4x12", note: "Nieuw" },
            { name: "Hammer Curl", sets: "4x12", note: "Nieuw" },
            { name: "Spider Curl", sets: "4x12", note: "Nieuw" },
            { name: "Straight Arm Pulldown", sets: "3x12", note: "Nieuw", optional: true },
          ],
          barbell: { name: "Barbell Pendlay Row", sets: "4x6", note: "Nieuw patroon" },
          kettlebell: [
            { name: "KB Sumo Deadlift", sets: "4x10", note: "Full body" },
            { name: "KB High Pull", sets: "3x12", note: "Full body explosief" },
            { name: "KB Suitcase Carry", sets: "3x20m/arm", note: "Full body" },
          ],
          core: [
            { name: "Ab Rollout (barbell)", sets: "3x10", note: "" },
            { name: "Hanging Windshield Wiper", sets: "3x10", note: "" },
            { name: "Farmer's Carry Core Hold", sets: "3x30sec", note: "" },
          ],
        },
        {
          dayId: 1,
          spiergroep: [
            { name: "Hack Squat Machine", sets: "4x10", note: "Nieuw" },
            { name: "Bulgarian Split Squat", sets: "4x10/been", note: "Nieuw" },
            { name: "Hip Thrust (barbell)", sets: "4x12", note: "Nieuw" },
            { name: "Leg Extension Machine", sets: "4x12", note: "Nieuw" },
            { name: "Standing Calf Raise", sets: "4x15", note: "Nieuw", optional: true },
          ],
          barbell: { name: "Barbell Front Squat", sets: "4x8", note: "Nieuw patroon" },
          kettlebell: [
            { name: "KB Snatch", sets: "4x8/arm", note: "Full body explosief" },
            { name: "KB Lateral Lunge", sets: "3x10/been", note: "Full body" },
            { name: "KB Swing (één arm)", sets: "3x12/arm", note: "Full body" },
          ],
          core: [
            { name: "Dragon Flag (negatief)", sets: "3x6", note: "" },
            { name: "Copenhagen Plank", sets: "3x30sec/zij", note: "" },
            { name: "V-Sit Hold", sets: "3x30sec", note: "" },
          ],
        },
      ],
    },
    {
      week: 5,
      label: "Week 27",
      phase: "Nieuwe Prikkel",
      days: [
        {
          dayId: 4,
          spiergroep: [
            { name: "Cable Lateral Raise", sets: "5x15", note: "+gewicht" },
            { name: "Reverse Fly (pec deck)", sets: "4x15", note: "+gewicht" },
            { name: "Barbell Upright Row", sets: "4x12", note: "+gewicht" },
            { name: "Dumbbell Front Raise", sets: "4x12", note: "+gewicht" },
            { name: "Arnold Press", sets: "4x10", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Push Press", sets: "5x5", note: "+gewicht piek" },
          kettlebell: [
            { name: "KB Bottoms-Up Press", sets: "4x10/arm", note: "+gewicht" },
            { name: "KB Snatch", sets: "4x8/arm", note: "+gewicht" },
            { name: "KB Figure 8", sets: "4x15", note: "+gewicht" },
          ],
          core: [
            { name: "Landmine Rotation", sets: "4x12", note: "" },
            { name: "Stir the Pot (bosu/ball)", sets: "3x40sec", note: "" },
            { name: "Cable Woodchop", sets: "4x12/zij", note: "" },
          ],
        },
        {
          dayId: 2,
          spiergroep: [
            { name: "Decline Dumbbell Press", sets: "5x10", note: "+gewicht" },
            { name: "Pec Deck Machine", sets: "4x12", note: "+gewicht" },
            { name: "Overhead Tricep Extension", sets: "4x15", note: "+gewicht" },
            { name: "Cable Tricep Kickback", sets: "4x15", note: "+gewicht" },
            { name: "Chest Dip", sets: "4x10", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Close Grip Bench Press", sets: "5x6", note: "+gewicht piek" },
          kettlebell: [
            { name: "KB Floor Press", sets: "4x12", note: "+gewicht" },
            { name: "KB Windmill", sets: "4x8/arm", note: "+gewicht" },
            { name: "KB Single Arm Swing", sets: "4x12/arm", note: "+gewicht" },
          ],
          core: [
            { name: "Hollow Body Hold", sets: "3x50sec", note: "" },
            { name: "TRX/Ring Fallout", sets: "3x12", note: "" },
            { name: "Weighted Sit-Up", sets: "4x15", note: "" },
          ],
        },
        {
          dayId: 3,
          spiergroep: [
            { name: "T-Bar Row", sets: "5x10", note: "+gewicht" },
            { name: "Wide Grip Pulldown", sets: "4x12", note: "+gewicht" },
            { name: "Hammer Curl", sets: "4x15", note: "+gewicht" },
            { name: "Spider Curl", sets: "4x15", note: "+gewicht" },
            { name: "Straight Arm Pulldown", sets: "4x12", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Pendlay Row", sets: "5x5", note: "+gewicht piek" },
          kettlebell: [
            { name: "KB Sumo Deadlift", sets: "5x10", note: "+gewicht" },
            { name: "KB High Pull", sets: "4x12", note: "+gewicht" },
            { name: "KB Suitcase Carry", sets: "4x20m/arm", note: "+gewicht" },
          ],
          core: [
            { name: "Ab Rollout (barbell)", sets: "4x10", note: "" },
            { name: "Hanging Windshield Wiper", sets: "3x12", note: "" },
            { name: "Farmer's Carry Core Hold", sets: "3x40sec", note: "" },
          ],
        },
        {
          dayId: 1,
          spiergroep: [
            { name: "Hack Squat Machine", sets: "5x10", note: "+gewicht" },
            { name: "Bulgarian Split Squat", sets: "4x12/been", note: "+gewicht" },
            { name: "Hip Thrust (barbell)", sets: "5x12", note: "+gewicht" },
            { name: "Leg Extension Machine", sets: "5x12", note: "+gewicht" },
            { name: "Standing Calf Raise", sets: "5x15", note: "+gewicht", optional: true },
          ],
          barbell: { name: "Barbell Front Squat", sets: "5x6", note: "+gewicht piek" },
          kettlebell: [
            { name: "KB Snatch", sets: "5x8/arm", note: "+gewicht" },
            { name: "KB Lateral Lunge", sets: "4x10/been", note: "+gewicht" },
            { name: "KB Swing (één arm)", sets: "4x12/arm", note: "+gewicht" },
          ],
          core: [
            { name: "Dragon Flag (negatief)", sets: "3x8", note: "" },
            { name: "Copenhagen Plank", sets: "3x45sec/zij", note: "" },
            { name: "V-Sit Hold", sets: "3x40sec", note: "" },
          ],
        },
      ],
    },
  ],
};

const dayColors = {
  1: { bg: "#fff1f2", accent: "#e63946", light: "#fecdd3" },
  2: { bg: "#eff6ff", accent: "#2563eb", light: "#bfdbfe" },
  3: { bg: "#f5f3ff", accent: "#7c3aed", light: "#ede9fe" },
  4: { bg: "#fefce8", accent: "#ca8a04", light: "#fef08a" },
};

const phaseColors = {
  "Opbouw": { bg: "#dbeafe", text: "#1e40af", dot: "#3b82f6" },
  "Nieuwe Prikkel": { bg: "#ede9fe", text: "#6d28d9", dot: "#8b5cf6" },
};

function getCurrentWeekIndex() {
  const d = new Date();
  const dayOfWeek = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dayOfWeek);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const isoWeek = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return Math.min(Math.max(isoWeek - 23, 0), 4);
}

function wKey(exercise, week) {
  return `${exercise}__${week}`;
}

function dKey(weekNum, dayId) {
  return `${weekNum}__${dayId}`;
}

function eKey(exercise, weekNum, dayId) {
  return `${exercise}__${weekNum}__${dayId}`;
}

function sKey(original, weekNum, dayId) {
  return `${original}__${weekNum}__${dayId}`;
}

function playBoxingBell() {
  const audio = new Audio("/boxing-bell.mp3");
  audio.volume = 1.0;
  audio.play().catch(() => {});
}

function triggerVibration() {
  Haptics.vibrate({ duration: 1600 }).catch(() => {});
}

function triggerImpact() {
  Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

function useTimer(initialSeconds, { onComplete } = {}) {
  const [timeLeft, setTimeLeft] = useState(initialSeconds);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);
  const audioCtxRef = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const getAudioCtx = () => {
    if (!audioCtxRef.current)
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtxRef.current;
  };

  useEffect(() => {
    if (running && timeLeft > 0) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(intervalRef.current);
            setRunning(false);
            playBoxingBell();
            triggerVibration();
            onCompleteRef.current?.();
            return 0;
          }
          return t - 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  const start = (seconds) => {
    clearInterval(intervalRef.current);
    setTimeLeft(seconds);
    setRunning(true);
    getAudioCtx().resume();
  };
  const pause = () => { clearInterval(intervalRef.current); setRunning(false); };
  const reset = (seconds) => { clearInterval(intervalRef.current); setRunning(false); setTimeLeft(seconds); };

  return { timeLeft, running, start, pause, reset };
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTimerLabel(seconds) {
  if (seconds % 60 === 0) return `${seconds / 60}min`;
  return `${seconds}sec`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 10, padding: "10px 14px", boxShadow: "0 4px 12px #0002" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#1a1a1a" }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
          <span style={{ color: "#666" }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: "#1a1a1a" }}>{p.value} kg</span>
        </div>
      ))}
    </div>
  );
}

const HIIT_INTERVALS = {
  4: { work: 30, rest: 20 },
  5: { work: 35, rest: 20 },
};

const KB_EXERCISES = [
  "KB Alternating March", "KB Around the World", "KB Bottoms-Up Press",
  "KB Clean & Press", "KB Farmer's Carry", "KB Figure 8", "KB Floor Press",
  "KB Halo", "KB High Pull", "KB Lateral Lunge", "KB Single Arm Swing",
  "KB Snatch", "KB Suitcase Carry", "KB Sumo Deadlift", "KB Swing",
  "KB Swing (één arm)", "KB Windmill", "KB Wood Chop",
];

export default function FitnessSchema() {
  const [selectedWeek, setSelectedWeek] = useState(getCurrentWeekIndex);
  const [selectedDay, setSelectedDay] = useState(() => {
    const saved = localStorage.getItem("selectedDay");
    return saved !== null ? Number(saved) : 0;
  });
  const [weights, setWeights] = useState({});
  const [activeTimer, setActiveTimer] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [timerLocked, setTimerLocked] = useState(false);
  const bbTimerRef = useRef(null);
  const bbLongPressed = useRef(false);
  const bbStartPos = useRef({ x: 0, y: 0 });

  const { timeLeft, running, start, pause, reset } = useTimer(120);
  const [expandedExercise, setExpandedExercise] = useState(null);
  const [completedDays, setCompletedDays] = useState(new Set());
  const [completedExercises, setCompletedExercises] = useState(new Set());
  const [swaps, setSwaps] = useState({});
  const [swapModal, setSwapModal] = useState(null);
  const [progressieOpen, setProgressieOpen] = useState(false);
  const [progressieExercise, setProgressieExercise] = useState(null);

  useEffect(() => {
    supabase.from("weights").select("*").then(({ data }) => {
      if (!data) return;
      const map = {};
      for (const row of data) {
        const k = wKey(row.exercise, row.week);
        if (!map[k]) map[k] = { M: "", Z: "" };
        map[k][row.person] = row.weight ?? "";
      }
      setWeights(map);
    });
    supabase.from("completed_days").select("*").then(({ data }) => {
      if (!data) return;
      setCompletedDays(new Set(data.map((r) => dKey(r.week, r.day))));
    });
    supabase.from("completed_exercises").select("*").then(({ data }) => {
      if (!data) return;
      setCompletedExercises(new Set(data.map((r) => eKey(r.exercise, r.week, r.day))));
    });
    supabase.from("exercise_swaps").select("*").then(({ data }) => {
      if (!data) return;
      const map = {};
      for (const row of data) map[sKey(row.original_exercise, row.week, row.day)] = row.new_exercise;
      setSwaps(map);
    });
  }, []);

  useEffect(() => { localStorage.setItem("selectedDay", selectedDay); }, [selectedDay]);

  const week = schema.weeks[selectedWeek];
  const day = week.days[selectedDay];
  const dayInfo = schema.days[selectedDay];
  const colors = dayColors[dayInfo.id];
  const phase = phaseColors[week.phase];

  const saveWeight = (exercise, weekNum, person, value) => {
    if (value === "" || value === null || value === undefined) return;
    supabase.from("weights").upsert(
      { exercise, week: weekNum, person, weight: Number(value) },
      { onConflict: "exercise,week,person" }
    ).then(({ error }) => {
      if (error) console.error("[saveWeight error]", error);
    });
  };

  const flushSave = (exerciseName, weekNum) => {
    const k = wKey(exerciseName, weekNum);
    const w = weights[k] || {};
    if (w.M !== "" && w.M !== undefined) saveWeight(exerciseName, weekNum, "M", w.M);
    if (w.Z !== "" && w.Z !== undefined) saveWeight(exerciseName, weekNum, "Z", w.Z);
  };

  const handleExerciseClick = (name) => {
    const weekNum = week.week;
    if (expandedExercise && expandedExercise !== name) {
      flushSave(expandedExercise, weekNum);
    }
    setExpandedExercise((prev) => (prev === name ? null : name));
  };

  const handleWeightChange = (exercise, weekNum, person, value) => {
    const k = wKey(exercise, weekNum);
    setWeights((prev) => ({
      ...prev,
      [k]: { ...(prev[k] || { M: "", Z: "" }), [person]: value },
    }));
    saveWeight(exercise, weekNum, person, value);
  };

  const closeAndSave = () => {
    if (expandedExercise) {
      flushSave(expandedExercise, week.week);
      setExpandedExercise(null);
    }
  };

  const saveSwap = (original, newExercise, weekNum, dayId) => {
    const k = sKey(original, weekNum, dayId);
    setSwaps((prev) => ({ ...prev, [k]: newExercise }));
    supabase.from("exercise_swaps").upsert(
      { original_exercise: original, new_exercise: newExercise, week: weekNum, day: dayId },
      { onConflict: "original_exercise,week,day" }
    ).then(({ error }) => { if (error) console.error("[saveSwap error]", error); });
    setSwapModal(null);
  };

  const handleTimerClick = (key, label, icon, seconds, accent) => {
    if (activeTimer === key) {
      setActiveTimer(null);
      setActiveSection(null);
      setTimerLocked(false);
      pause();
    } else {
      setActiveTimer(key);
      setActiveSection({ key, label, icon, seconds, accent });
      setTimerLocked(true);
      start(seconds);
    }
  };

  const bbStartPress = (e) => {
    bbLongPressed.current = false;
    const t = e.touches?.[0];
    if (t) bbStartPos.current = { x: t.clientX, y: t.clientY };
    bbTimerRef.current = setTimeout(() => {
      bbLongPressed.current = true;
      triggerImpact();
      toggleExerciseCompletion(day.barbell.name, week.week, dayInfo.id);
    }, 1000);
  };
  const bbCancelPress = () => clearTimeout(bbTimerRef.current);
  const bbHandleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - bbStartPos.current.x) > 10 || Math.abs(t.clientY - bbStartPos.current.y) > 10) bbCancelPress();
  };

  const toggleDayCompletion = (weekNum, dayId) => {
    const k = dKey(weekNum, dayId);
    if (completedDays.has(k)) {
      setCompletedDays((prev) => { const s = new Set(prev); s.delete(k); return s; });
      supabase.from("completed_days").delete().eq("week", weekNum).eq("day", dayId).then();
    } else {
      setCompletedDays((prev) => new Set([...prev, k]));
      supabase.from("completed_days").insert({ week: weekNum, day: dayId }).then();
    }
  };

  const toggleExerciseCompletion = (exercise, weekNum, dayId) => {
    const k = eKey(exercise, weekNum, dayId);
    if (completedExercises.has(k)) {
      setCompletedExercises((prev) => { const s = new Set(prev); s.delete(k); return s; });
      supabase.from("completed_exercises").delete().eq("exercise", exercise).eq("week", weekNum).eq("day", dayId).then();
    } else {
      setCompletedExercises((prev) => new Set([...prev, k]));
      supabase.from("completed_exercises").insert({ exercise, week: weekNum, day: dayId }).then();
    }
  };

  return (
    <div style={{ fontFamily: "'Georgia', serif", minHeight: "100vh", background: "#f8f7f4", color: "#1a1a1a", userSelect: "none", WebkitUserSelect: "none", paddingBottom: activeTimer ? 100 : 0 }}>
      {/* Header */}
      <div style={{ background: "#f37121", color: "#fff", padding: "24px 20px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 4, textTransform: "uppercase", color: "#888", marginBottom: 6 }}>Basic Fit · Gevorderd</div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>5-Weken Trainingsschema</h1>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "center", gap: 6 }}>
          <span style={{ background: phase.bg, color: phase.text, fontSize: 11, padding: "3px 10px", borderRadius: 20, fontFamily: "sans-serif" }}>
            {week.phase}
          </span>
        </div>
      </div>

      {/* Week selector */}
      <div style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "14px 16px", overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", minWidth: "fit-content", margin: "0 auto" }}>
          {schema.weeks.map((w, i) => (
            <button
              key={i}
              onClick={() => { closeAndSave(); setSelectedWeek(i); }}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontFamily: "sans-serif",
                fontSize: 13,
                fontWeight: selectedWeek === i ? 700 : 400,
                background: selectedWeek === i ? "#f37121" : "#f0f0f0",
                color: selectedWeek === i ? "#fff" : "#555",
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Day selector */}
      <div style={{ padding: "16px 16px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, maxWidth: 600, margin: "0 auto" }}>
        {schema.days.map((d, i) => (
          <DayButton
            key={i}
            day={d}
            isSelected={selectedDay === i}
            isCompleted={completedDays.has(dKey(week.week, d.id))}
            colors={dayColors[d.id]}
            onSelect={() => { closeAndSave(); setSelectedDay(i); }}
            onLongPress={() => toggleDayCompletion(week.week, d.id)}
          />
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "16px", maxWidth: 600, margin: "0 auto" }}>

        {/* Barbell */}
        <Section
          title="Barbell Hoofdoefening"
          icon="🏋️"
          accent="#f37121"
          timerSeconds={120}
          timerActive={activeTimer === "barbell"}
          onTimerClick={() => handleTimerClick("barbell", "Barbell Hoofdoefening", "🏋️", 120, "#f37121")}
        >
          {(() => {
            const k = wKey(day.barbell.name, week.week);
            const w = weights[k] || { M: "", Z: "" };
            const prevK = week.week > 1 ? wKey(day.barbell.name, week.week - 1) : null;
            const prevW = prevK ? (weights[prevK] || { M: "", Z: "" }) : { M: null, Z: null };
            const hasPrev = prevW.M !== "" && prevW.M != null || prevW.Z !== "" && prevW.Z != null;
            const barbellCompleted = completedExercises.has(eKey(day.barbell.name, week.week, dayInfo.id));
            return (
              <div style={{ borderRadius: 10, overflow: "hidden" }}>
                <div
                  style={{ background: "#f37121", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                  onClick={(e) => { if (bbLongPressed.current) { bbLongPressed.current = false; e.stopPropagation(); return; } handleExerciseClick(day.barbell.name); }}
                  onMouseDown={bbStartPress} onMouseUp={bbCancelPress}
                  onTouchStart={bbStartPress} onTouchEnd={bbCancelPress} onTouchMove={bbHandleTouchMove}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ visibility: barbellCompleted ? "visible" : "hidden", width: 24, height: 24, borderRadius: "50%", background: "#16a34a", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", fontWeight: 700, flexShrink: 0 }}>✓</span>
                    <div>
                      <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{day.barbell.name}</div>
                      {day.barbell.note && <div style={{ color: "#ffcfa0", fontSize: 12, fontFamily: "sans-serif", marginTop: 2 }}>{day.barbell.note}</div>}
                    </div>
                  </div>
                  <div style={{ background: "#fff", color: "#f37121", padding: "5px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap" }}>
                    {day.barbell.sets}
                  </div>
                </div>
                {expandedExercise === day.barbell.name && (
                  <div
                    style={{ background: "#fff8f5", borderTop: "1px solid #f0d0b8", padding: "10px 12px 10px 16px", display: "flex", flexDirection: "column", gap: 8 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                      {["M", "Z"].map((person) => (
                        <div key={person} style={{ display: person === "Z" ? "none" : "flex", alignItems: "center", gap: 6 }}>
                          <label style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#888" }}>{person}:</label>
                          <input
                            type="number"
                            step="any"
                            min={0}
                            value={person === "M" ? w.M : w.Z}
                            onChange={(e) => handleWeightChange(day.barbell.name, week.week, person, e.target.value)}
                            placeholder="kg"
                            style={{ width: 70, padding: "5px 8px", borderRadius: 6, border: "1px solid #e0c8b8", fontFamily: "sans-serif", fontSize: 13, outline: "none", background: "#fff" }}
                          />
                        </div>
                      ))}
                    </div>
                    {hasPrev && (
                      <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#bbb" }}>
                        Vorige week  <span style={{ color: "#1a1a1a" }}>M:</span> <span style={{ color: "#1a1a1a" }}>{prevW.M !== "" && prevW.M != null ? `${prevW.M}kg` : "—"}</span><span style={{ display: "none" }}> / <span style={{ color: "#1a1a1a" }}>Z:</span> <span style={{ color: "#1a1a1a" }}>{prevW.Z !== "" && prevW.Z != null ? `${prevW.Z}kg` : "—"}</span></span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </Section>

        {/* Spiergroep */}
        <Section
          title="Spiergroep Oefeningen"
          icon="🎯"
          accent={colors.accent}
          timerSeconds={90}
          timerActive={activeTimer === "spiergroep"}
          onTimerClick={() => handleTimerClick("spiergroep", "Spiergroep Oefeningen", "🎯", 90, colors.accent)}
        >
          {day.spiergroep.map((ex, i) => {
            const k = wKey(ex.name, week.week);
            const w = weights[k] || { M: "", Z: "" };
            const prevK = week.week > 1 ? wKey(ex.name, week.week - 1) : null;
            const prevW = prevK ? (weights[prevK] || { M: "", Z: "" }) : { M: null, Z: null };
            return (
              <ExRow
                key={i}
                num={i + 1}
                name={ex.name}
                sets={ex.sets}
                note={ex.note}
                accent={colors.accent}
                light={colors.light}
                optional={ex.optional}
                expanded={expandedExercise === ex.name}
                onToggle={() => handleExerciseClick(ex.name)}
                weightM={w.M}
                weightZ={w.Z}
                onWeightChange={(person, value) => handleWeightChange(ex.name, week.week, person, value)}
                prevWeightM={prevW.M}
                prevWeightZ={prevW.Z}
                completed={completedExercises.has(eKey(ex.name, week.week, dayInfo.id))}
                onLongPress={() => toggleExerciseCompletion(ex.name, week.week, dayInfo.id)}
              />
            );
          })}
        </Section>

        {/* Kettlebell */}
        <Section
          title="Kettlebell (Full Body)"
          icon="🔔"
          accent="#c05621"
          timerSeconds={60}
          timerActive={activeTimer === "kettlebell"}
          onTimerClick={() => handleTimerClick("kettlebell", "Kettlebell (Full Body)", "🔔", 60, "#c05621")}
        >
          {(() => {
            const hiitInterval = HIIT_INTERVALS[week.week] || null;
            return (
              <>
                {hiitInterval && (
                  <div style={{
                    margin: "0 0 8px",
                    background: "#fff8f3",
                    border: "1.5px solid #f37121",
                    borderRadius: 10,
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18 }}>⚡</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#f37121", fontFamily: "sans-serif" }}>HIIT Intervallen</div>
                        <div style={{ fontSize: 11, color: "#888", fontFamily: "sans-serif" }}>werk / rust per oefening</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#f37121", lineHeight: 1, fontFamily: "sans-serif" }}>{hiitInterval.work}s</div>
                        <div style={{ fontSize: 10, color: "#888", fontFamily: "sans-serif" }}>werk</div>
                      </div>
                      <div style={{ fontSize: 16, color: "#ccc" }}>/</div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#888", lineHeight: 1, fontFamily: "sans-serif" }}>{hiitInterval.rest}s</div>
                        <div style={{ fontSize: 10, color: "#888", fontFamily: "sans-serif" }}>rust</div>
                      </div>
                    </div>
                  </div>
                )}
                {day.kettlebell.map((ex, i) => {
                  const sk = sKey(ex.name, week.week, dayInfo.id);
                  const swappedName = swaps[sk];
                  const displayName = swappedName || ex.name;
                  const k = wKey(displayName, week.week);
                  const w = weights[k] || { M: "", Z: "" };
                  const prevK = week.week > 1 ? wKey(displayName, week.week - 1) : null;
                  const prevW = prevK ? (weights[prevK] || { M: "", Z: "" }) : { M: null, Z: null };
                  return (
                    <SwipeableRow
                      key={i}
                      onSwipeRight={() => { closeAndSave(); setSwapModal({ original: ex.name, week: week.week, day: dayInfo.id }); }}
                    >
                      <ExRow
                        num={i + 1}
                        name={displayName}
                        sets={ex.sets}
                        note={ex.note}
                        accent="#c05621"
                        light="#fed7aa"
                        expanded={expandedExercise === displayName}
                        onToggle={() => handleExerciseClick(displayName)}
                        weightM={w.M}
                        weightZ={w.Z}
                        onWeightChange={(person, value) => handleWeightChange(displayName, week.week, person, value)}
                        prevWeightM={prevW.M}
                        prevWeightZ={prevW.Z}
                        completed={completedExercises.has(eKey(displayName, week.week, dayInfo.id))}
                        onLongPress={() => toggleExerciseCompletion(displayName, week.week, dayInfo.id)}
                        swapped={!!swappedName}
                        originalName={swappedName ? ex.name : undefined}
                        hiitInterval={hiitInterval}
                      />
                    </SwipeableRow>
                  );
                })}
              </>
            );
          })()}
        </Section>

        {/* Core */}
        <Section
          title="Core Finisher"
          icon="🔥"
          accent="#7c3aed"
          timerSeconds={45}
          timerActive={activeTimer === "core"}
          onTimerClick={() => handleTimerClick("core", "Core Finisher", "🔥", 45, "#7c3aed")}
        >
          {day.core.map((ex, i) => {
            return (
              <ExRow
                key={i}
                num={i + 1}
                name={ex.name}
                sets={ex.sets}
                note={ex.note}
                accent="#7c3aed"
                light="#ede9fe"
                completed={completedExercises.has(eKey(ex.name, week.week, dayInfo.id))}
                onLongPress={() => toggleExerciseCompletion(ex.name, week.week, dayInfo.id)}
              />
            );
          })}
        </Section>

        {/* Progress note */}
        {selectedWeek < 3 && (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "12px 14px", marginTop: 4, fontFamily: "sans-serif", fontSize: 13, color: "#166534" }}>
            <strong>📈 Progressie:</strong> Verhoog het gewicht elke week. Week 1 = basisgewicht, Week 2 = +5kg/zwaarder, Week 3 = piekgewicht.
          </div>
        )}
        {selectedWeek >= 3 && (
          <div style={{ background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 10, padding: "12px 14px", marginTop: 4, fontFamily: "sans-serif", fontSize: 13, color: "#5b21b6" }}>
            <strong>⚡ Nieuwe prikkel:</strong> Nieuwe oefeningen activeren andere spiervezels. Begin met een goed uitvoerbaar gewicht en bouw op in week 5.
          </div>
        )}

        <div style={{ textAlign: "center", color: "#bbb", fontSize: 11, fontFamily: "sans-serif", marginTop: 20, marginBottom: 8 }}>
          Core dagelijks herhalen · Rust: 60–90 sec tussen sets
        </div>

        {/* Progressie */}
        {(() => {
          const dayExercises = [
            day.barbell.name,
            ...day.spiergroep.map(e => e.name),
            ...day.kettlebell.map(e => e.name),
          ];
          const uniq = (arr) => [...new Set(arr)].filter(e => !dayExercises.includes(e));
          const allBarbell = uniq(schema.weeks.flatMap(w => w.days.map(d => d.barbell.name)));
          const allSpiergroep = uniq(schema.weeks.flatMap(w => w.days.flatMap(d => d.spiergroep.map(e => e.name))));
          const allKettlebell = uniq(schema.weeks.flatMap(w => w.days.flatMap(d => d.kettlebell.map(e => e.name))));
          const allCore = uniq(schema.weeks.flatMap(w => w.days.flatMap(d => d.core.map(e => e.name))));
          const allExercises = [...dayExercises, ...allBarbell, ...allSpiergroep, ...allKettlebell, ...allCore];
          const selEx = progressieExercise ?? allExercises[0];
          const chartData = schema.weeks.map(w => {
            const mVal = weights[wKey(selEx, w.week)]?.M;
            const zVal = weights[wKey(selEx, w.week)]?.Z;
            return {
              week: `W${w.label.replace("Week ", "")}`,
              M: mVal !== "" && mVal != null ? Number(mVal) : null,
              Z: zVal !== "" && zVal != null ? Number(zVal) : null,
            };
          });
          const mVals = chartData.map(d => d.M).filter(v => v != null);
          const zVals = chartData.map(d => d.Z).filter(v => v != null);
          const mMax = mVals.length ? Math.max(...mVals) : null;
          const zMax = zVals.length ? Math.max(...zVals) : null;
          const mGain = mVals.length >= 2 ? mVals[mVals.length - 1] - mVals[0] : null;
          const zGain = zVals.length >= 2 ? zVals[zVals.length - 1] - zVals[0] : null;
          return (
            <div style={{ marginTop: 12 }}>
              <div style={{
                background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px #0001", overflow: "hidden",
                border: progressieOpen ? "2px solid #f37121" : "2px solid transparent", transition: "border 0.2s",
              }}>
                <button
                  onClick={() => setProgressieOpen(o => !o)}
                  style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18 }}>📈</span>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "#1a1a1a" }}>Progressie</span>
                  </div>
                  <span style={{ fontSize: 18, color: "#f37121", transform: progressieOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s", display: "inline-block" }}>⌄</span>
                </button>
                {progressieOpen && (
                  <div style={{ padding: "0 16px 16px" }}>
                    <select
                      value={selEx}
                      onChange={e => setProgressieExercise(e.target.value)}
                      style={{
                        width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #f37121",
                        fontSize: 14, fontWeight: 600, color: "#1a1a1a", background: "#fff", marginBottom: 16,
                        cursor: "pointer", outline: "none", appearance: "none",
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23f37121' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                        backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center", paddingRight: 36,
                      }}
                    >
                      {allExercises.map(ex => <option key={ex} value={ex}>{ex}</option>)}
                    </select>
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      <div style={{ flex: 1, background: "#fff8f3", border: "1px solid #f3712133", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>M — Max</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#f37121" }}>{mMax != null ? `${mMax} kg` : "—"}</div>
                        <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>{mGain != null ? `+${mGain} kg` : "—"}</div>
                      </div>
                      <div style={{ flex: 1, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "#888", marginBottom: 2 }}>Z — Max</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#0ea5e9" }}>{zMax != null ? `${zMax} kg` : "—"}</div>
                        <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>{zGain != null ? `+${zGain} kg` : "—"}</div>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#888" }} />
                        <YAxis tick={{ fontSize: 12, fill: "#888" }} unit=" kg" />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} formatter={v => <span style={{ color: "#555", fontWeight: 600 }}>{v}</span>} />
                        <Line type="monotone" dataKey="M" stroke="#f37121" strokeWidth={3} dot={{ fill: "#f37121", strokeWidth: 2, r: 5 }} activeDot={{ r: 7 }} connectNulls />
                        <Line type="monotone" dataKey="Z" stroke="#0ea5e9" strokeWidth={3} dot={{ fill: "#0ea5e9", strokeWidth: 2, r: 5 }} activeDot={{ r: 7 }} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {timerLocked && <div style={{ position: "fixed", inset: 0, zIndex: 49 }} />}

      {activeTimer && activeSection && (() => {
        const progress = activeSection.seconds > 0 ? timeLeft / activeSection.seconds : 0;
        const isDone = timeLeft === 0;
        return (
          <div style={{
            position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
            width: "calc(100% - 32px)", maxWidth: 568, background: isDone ? "#16a34a" : activeSection.accent,
            color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", gap: 14,
            boxShadow: "0 -4px 20px #0004", borderRadius: "20px 20px 0 0", transition: "background 0.3s", zIndex: 50,
            overflow: "hidden",
          }}>
            {timerLocked && (
              <div style={{ position: "absolute", inset: 0, background: isDone ? "#16a34a" : activeSection.accent, display: "flex", alignItems: "center", padding: "0 20px", gap: 14, zIndex: 1 }}>
                <div style={{ position: "relative", width: 75, height: 75, flexShrink: 0 }}>
                  <svg width="75" height="75" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="37.5" cy="37.5" r="31" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
                    <circle cx="37.5" cy="37.5" r="31" fill="none" stroke="#fff" strokeWidth="4"
                      strokeDasharray={2 * Math.PI * 31}
                      strokeDashoffset={2 * Math.PI * 31 * (1 - progress)}
                      strokeLinecap="round"
                      style={{ transition: "stroke-dashoffset 0.9s linear" }}
                    />
                  </svg>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: isDone ? 31 : 19, fontWeight: 700 }}>
                    {isDone ? "🔔" : formatTime(timeLeft)}
                  </div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>{activeSection.icon} {activeSection.label} rust</div>
                  {isDone && <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>Rust voorbij, ga! 💪</div>}
                </div>
                <button onClick={() => setTimerLocked(false)}
                  style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 20, WebkitAppearance: "none", appearance: "none", width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  🔓
                </button>
              </div>
            )}
            <div style={{ position: "relative", width: 75, height: 75, flexShrink: 0 }}>
              <svg width="75" height="75" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="37.5" cy="37.5" r="31" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="4" />
                <circle cx="37.5" cy="37.5" r="31" fill="none" stroke="#fff" strokeWidth="4"
                  strokeDasharray={2 * Math.PI * 31}
                  strokeDashoffset={2 * Math.PI * 31 * (1 - progress)}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.9s linear" }}
                />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: isDone ? 31 : 19, fontWeight: 700 }}>
                {isDone ? "🔔" : formatTime(timeLeft)}
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
              <div style={{ fontSize: 13, opacity: 0.8 }}>{activeSection.icon} {activeSection.label} rust</div>
              {isDone && <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2, marginTop: 2 }}>Rust voorbij, ga! 💪</div>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {!isDone && (
                <button onClick={() => { if (running) { pause(); } else { start(timeLeft); } }}
                  style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 20, lineHeight: 1, WebkitAppearance: "none", appearance: "none", width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {running ? "II" : "▶"}
                </button>
              )}
              <button onClick={() => { reset(activeSection.seconds); start(activeSection.seconds); setTimerLocked(true); }}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 20, lineHeight: 1, WebkitAppearance: "none", appearance: "none", width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                ↺
              </button>
              <button onClick={() => { setActiveTimer(null); setActiveSection(null); setTimerLocked(false); pause(); }}
                style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", borderRadius: 8, cursor: "pointer", fontSize: 20, lineHeight: 1, WebkitAppearance: "none", appearance: "none", width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                ✕
              </button>
            </div>
          </div>
        );
      })()}

      {swapModal && (
        <BottomSheet
          currentExercise={swaps[sKey(swapModal.original, swapModal.week, swapModal.day)] || swapModal.original}
          exercises={KB_EXERCISES.filter((n) => n !== (swaps[sKey(swapModal.original, swapModal.week, swapModal.day)] || swapModal.original))}
          onSelect={(name) => saveSwap(swapModal.original, name, swapModal.week, swapModal.day)}
          onClose={() => setSwapModal(null)}
        />
      )}
    </div>
  );
}

function Section({ title, icon, accent, timerSeconds, timerActive, onTimerClick, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, marginBottom: 12, overflow: "hidden", boxShadow: "0 1px 4px #0001" }}>
      <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#1a1a1a" }}>{title}</span>
        </div>
        <button
          onClick={onTimerClick}
          style={{ background: timerActive ? accent : "#f0f0f0", border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: timerActive ? "#fff" : "#555", transition: "all 0.15s" }}
        >
          ⏱ {formatTimerLabel(timerSeconds)}
        </button>
      </div>
      <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function ExRow({ num, name, sets, note, accent, light, optional, expanded, onToggle, weightM, weightZ, onWeightChange, prevWeightM, prevWeightZ, completed, onLongPress, swapped, originalName, hiitInterval }) {
  const isClickable = !!onToggle;
  const hasPrev = (prevWeightM !== "" && prevWeightM != null) || (prevWeightZ !== "" && prevWeightZ != null);
  return (
    <div style={{ borderRadius: 8, overflow: "hidden", border: optional ? "1.5px dashed #f37121" : "none" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, background: light + "55", padding: "10px 12px", cursor: isClickable ? "pointer" : "default" }}
        onClick={onToggle}
      >
        <ExCircle num={num} completed={completed} accent={accent} optional={optional} onLongPress={onLongPress} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>{name}</span>
            {optional && <span style={{ fontSize: 10, background: "#fff0e6", color: "#f37121", padding: "2px 7px", borderRadius: 10, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: 0.5, border: "1px solid #f37121" }}>OPTIONEEL</span>}
            {swapped && <span style={{ fontSize: 10, background: "#fff0e6", color: "#f37121", padding: "2px 7px", borderRadius: 10, fontFamily: "sans-serif", fontWeight: 700, letterSpacing: 0.5, border: "1px solid #f37121" }}>GEWIJZIGD</span>}
          </div>
          {note && <div style={{ fontSize: 11, color: optional ? "#f37121" : accent, fontFamily: "sans-serif", marginTop: 1 }}>{note}</div>}
          {originalName && <div style={{ fontSize: 11, color: "#bbb", fontFamily: "sans-serif", marginTop: 1 }}>↩ {originalName}</div>}
        </div>
        {hiitInterval ? (
          <div style={{ display: "flex" }}>
            <div style={{ background: "#f37121", color: "#fff", padding: "4px 8px", borderRadius: "10px 0 0 10px", fontSize: 12, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap" }}>
              {hiitInterval.work}s
            </div>
            <div style={{ background: "#888", color: "#fff", padding: "4px 8px", borderRadius: "0 10px 10px 0", fontSize: 12, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap" }}>
              {hiitInterval.rest}s
            </div>
          </div>
        ) : (
          <div style={{ background: optional ? "#fff0e6" : accent, color: optional ? "#f37121" : "#fff", padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700, fontFamily: "sans-serif", whiteSpace: "nowrap", border: optional ? "1px solid #f37121" : "none" }}>
            {sets}
          </div>
        )}
      </div>
      {expanded && (
        <div
          style={{ background: "#fff8f5", borderTop: "1px solid #f0d0b8", padding: "10px 12px 10px 48px", display: "flex", flexDirection: "column", gap: 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            {["M", "Z"].map((person) => (
              <div key={person} style={{ display: person === "Z" ? "none" : "flex", alignItems: "center", gap: 6 }}>
                <label style={{ fontFamily: "sans-serif", fontSize: 13, fontWeight: 700, color: "#888" }}>{person}:</label>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={person === "M" ? weightM : weightZ}
                  onChange={(e) => onWeightChange(person, e.target.value)}
                  placeholder="kg"
                  style={{ width: 70, padding: "5px 8px", borderRadius: 6, border: "1px solid #e0c8b8", fontFamily: "sans-serif", fontSize: 13, outline: "none", background: "#fff" }}
                />
              </div>
            ))}
          </div>
          {hasPrev && (
            <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#bbb" }}>
              Vorige week  <span style={{ color: "#1a1a1a" }}>M:</span> <span style={{ color: "#1a1a1a" }}>{prevWeightM !== "" && prevWeightM != null ? `${prevWeightM}kg` : "—"}</span><span style={{ display: "none" }}> / <span style={{ color: "#1a1a1a" }}>Z:</span> <span style={{ color: "#1a1a1a" }}>{prevWeightZ !== "" && prevWeightZ != null ? `${prevWeightZ}kg` : "—"}</span></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExCircle({ num, completed, accent, optional, onLongPress }) {
  const timer = useRef(null);
  const longPressed = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const startPress = (e) => {
    longPressed.current = false;
    const t = e.touches?.[0];
    if (t) startPos.current = { x: t.clientX, y: t.clientY };
    timer.current = setTimeout(() => {
      longPressed.current = true;
      triggerImpact();
      if (onLongPress) onLongPress();
    }, 1000);
  };

  const cancelPress = () => clearTimeout(timer.current);

  const handleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - startPos.current.x) > 10 || Math.abs(t.clientY - startPos.current.y) > 10) cancelPress();
  };

  return (
    <div
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={handleTouchMove}
      onClick={(e) => { if (longPressed.current) { longPressed.current = false; e.stopPropagation(); } }}
      style={{
        width: 26, height: 26, borderRadius: "50%",
        background: completed ? "#16a34a" : (optional ? "transparent" : accent),
        color: completed ? "#fff" : (optional ? "#f37121" : "#fff"),
        border: completed ? "none" : (optional ? "1.5px dashed #f37121" : "none"),
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: completed ? 14 : 12, fontWeight: 700, fontFamily: "sans-serif",
        flexShrink: 0, cursor: "pointer", userSelect: "none",
      }}
    >
      {completed ? "✓" : num}
    </div>
  );
}

function DayButton({ day, isSelected, isCompleted, colors, onSelect, onLongPress }) {
  const c = colors;
  const timer = useRef(null);
  const longPressed = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const startPress = (e) => {
    longPressed.current = false;
    const t = e.touches?.[0];
    if (t) startPos.current = { x: t.clientX, y: t.clientY };
    timer.current = setTimeout(() => {
      longPressed.current = true;
      triggerImpact();
      onLongPress();
    }, 1000);
  };

  const cancelPress = () => clearTimeout(timer.current);

  const handleTouchMove = (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - startPos.current.x) > 10 || Math.abs(t.clientY - startPos.current.y) > 10) cancelPress();
  };

  return (
    <button
      onMouseDown={startPress}
      onMouseUp={cancelPress}
      onTouchStart={startPress}
      onTouchEnd={cancelPress}
      onTouchMove={handleTouchMove}
      onClick={() => { if (longPressed.current) { longPressed.current = false; return; } onSelect(); }}
      style={{
        padding: "10px 6px",
        borderRadius: 10,
        border: isSelected ? `2px solid ${c.accent}` : "2px solid transparent",
        cursor: "pointer",
        background: isSelected ? c.bg : "#fff",
        textAlign: "center",
        transition: "all 0.15s",
        boxShadow: isSelected ? `0 2px 8px ${c.accent}33` : "0 1px 3px #0001",
        userSelect: "none",
      }}
    >
      <div style={{ position: "relative", display: "inline-block" }}>
        <div style={{ fontSize: 20 }}>{day.emoji}</div>
        {isCompleted && (
          <div style={{ position: "absolute", top: -4, right: -6, background: "#16a34a", color: "#fff", borderRadius: "50%", width: 14, height: 14, fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900 }}>✓</div>
        )}
      </div>
      <div style={{ fontSize: 10, fontFamily: "sans-serif", fontWeight: 600, color: isSelected ? c.accent : "#888", marginTop: 2, lineHeight: 1.2 }}>
        {day.name}
      </div>
    </button>
  );
}

function SwipeableRow({ onSwipeRight, children }) {
  const startX = useRef(null);
  const startY = useRef(null);
  const swiped = useRef(false);
  const isMouseDown = useRef(false);
  const [offsetX, setOffsetX] = useState(0);

  const onStart = (e) => {
    const p = e.touches?.[0] || e;
    startX.current = p.clientX;
    startY.current = p.clientY;
    swiped.current = false;
  };

  const onMove = (e) => {
    if (startX.current === null || swiped.current) return;
    const p = e.touches?.[0] || e;
    const dx = p.clientX - startX.current;
    const dy = Math.abs(p.clientY - startY.current);
    if (dy > 30 || dx < 0) { startX.current = null; setOffsetX(0); return; }
    setOffsetX(Math.min(dx, 80));
    if (dx >= 60) {
      swiped.current = true;
      startX.current = null;
      setOffsetX(0);
      onSwipeRight();
    }
  };

  const onEnd = () => { isMouseDown.current = false; startX.current = null; setOffsetX(0); };

  return (
    <div
      onMouseDown={(e) => { isMouseDown.current = true; onStart(e); }}
      onMouseMove={(e) => { if (isMouseDown.current) onMove(e); }}
      onMouseUp={onEnd}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onClick={(e) => { if (swiped.current) { swiped.current = false; e.stopPropagation(); } }}
      style={{ transform: `translateX(${offsetX}px)`, transition: offsetX === 0 ? "transform 0.2s" : "none" }}
    >
      {children}
    </div>
  );
}

function BottomSheet({ currentExercise, exercises, onSelect, onClose }) {
  const [hovered, setHovered] = useState(null);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#0005", zIndex: 100 }} />
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderRadius: "16px 16px 0 0", padding: "16px 16px 48px", zIndex: 101, maxHeight: "70vh", overflowY: "auto" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#ddd", margin: "0 auto 16px" }} />
        <div style={{ textAlign: "center", marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid #eee" }}>
          <div style={{ fontFamily: "sans-serif", fontSize: 11, color: "#999", marginBottom: 4, letterSpacing: 0.5, textTransform: "uppercase" }}>Wissel voor</div>
          <div style={{ fontFamily: "'Georgia', serif", fontWeight: 700, fontSize: 16, color: "#1a1a1a" }}>{currentExercise}</div>
        </div>
        {exercises.map((name) => (
          <div
            key={name}
            onClick={() => onSelect(name)}
            onMouseEnter={() => setHovered(name)}
            onMouseLeave={() => setHovered(null)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 8px", borderBottom: "1px solid #f0f0f0", fontFamily: "sans-serif", fontSize: 14, color: "#1a1a1a", cursor: "pointer", background: hovered === name ? "#fff8f3" : "transparent", transition: "background 0.15s" }}
          >
            <span>{name}</span>
            <span style={{ color: "#f37121", fontSize: 16, fontWeight: 700 }}>→</span>
          </div>
        ))}
      </div>
    </>
  );
}
