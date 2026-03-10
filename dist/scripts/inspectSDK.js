import 'dotenv/config';
import { GoogleGenAI } from "@google/genai";
const client = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? "",
});
console.log("Client keys:", Object.getOwnPropertyNames(client));
console.log("Client prototype keys:", Object.getOwnPropertyNames(Object.getPrototypeOf(client)));
if (client.models) {
    console.log("Models keys:", Object.getOwnPropertyNames(client.models));
}
