import { createClient } from '@supabase/supabase-js';

// Fallback values provided in the prompt for demo purposes
// In a real environment, these should be set in .env
const FALLBACK_URL = "https://fdxblowppmeaaqkxvbhh.supabase.co";
const FALLBACK_KEY = "sb_publishable_3JwscJWsIYeTChm2qo8Zwg_wterIXJR";

const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
    }
  } catch (e) {
    // Ignore
  }
  return undefined;
};

const supabaseUrl = getEnv('VITE_SUPABASE_URL') || FALLBACK_URL;
const supabaseKey = getEnv('VITE_SUPABASE_KEY') || FALLBACK_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
