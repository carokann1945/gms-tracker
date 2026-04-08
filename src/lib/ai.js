import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const GEMINI_MODEL = "gemini-2.5-flash";
export const useGemini = process.env.AI_PROVIDER === "gemini";
