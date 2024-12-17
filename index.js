// Import necessary libraries
import OpenAI from "openai";
import { TwitterApi } from "twitter-api-v2";
import cron from "node-cron";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();
import { fileURLToPath } from "url";
import path, { dirname } from "path";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration for OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Configuration for Twitter API
const twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_APP_KEY,
    appSecret: process.env.TWITTER_APP_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

// Topic to generate content about
const topic = process.env.TOPIC || "technology";

// Directory containing images
const imagesDir = path.join(__dirname, "images");

// Probability of using AI generated image (0 to 1)
const generateAiImageProbability =
    parseFloat(process.env.GENERATE_AI_IMAGE_PROB) || 0.2;

// Function to get a random image from the images directory
function getRandomImage() {
    console.log("Attempting to pick a random image...");
    if (!fs.existsSync(imagesDir)) {
        console.warn("Images directory not found.");
        return null;
    }

    const files = fs
        .readdirSync(imagesDir)
        .filter((file) => {
            const ext = path.extname(file).toLowerCase();
            return [
                ".jpg",
                ".jpeg",
                ".png",
                ".gif",
            ].includes(ext);
        });

    if (files.length === 0) {
        console.warn("No image files found in directory.");
        return null;
    }

    const randomFile =
        files[Math.floor(Math.random() * files.length)];
    console.log("Random image selected:", randomFile);
    return path.join(imagesDir, randomFile);
}

// Function to generate text content using GPT
async function generateContent(promptTopic) {
    console.log(
        "Generating content using OpenAI for topic:",
        promptTopic
    );
    const prompt = `${promptTopic}`;
    try {
        const response =
            await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "user", content: prompt },
                ],
            });

        const tweetContent =
            response.choices[0]?.message?.content?.trim();
        if (!tweetContent) {
            console.error(
                "OpenAI returned an empty response."
            );
            return null;
        }

        console.log("Generated content:", tweetContent);
        return tweetContent;
    } catch (error) {
        console.error(
            "Error generating content from OpenAI:",
            error
        );
        return null;
    }
}

// New function: generate image prompt using GPT
async function generateImagePrompt(content) {
    console.log(
        "Generating image prompt for content:",
        content
    );
    const prompt = `帖子内容为: "${content}"。请用简短的英语描述图片画面(不超过一句话)`;
    try {
        const response =
            await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "user", content: prompt },
                ],
            });

        const imagePrompt =
            response.choices[0]?.message?.content?.trim();
        if (!imagePrompt) {
            console.error(
                "OpenAI returned an empty response for image prompt generation."
            );
            return null;
        }

        console.log("Generated image prompt:", imagePrompt);
        return imagePrompt;
    } catch (error) {
        console.error(
            "Error generating image prompt from OpenAI:",
            error
        );
        return null;
    }
}

// Function to generate an AI image using DALL·E
async function generateAIImage(imagePrompt) {
    console.log(
        "Attempting to generate an AI image using DALL·E for prompt:",
        imagePrompt
    );
    try {
        const response = await openai.images.generate({
            prompt: `Create an image that visually represents the following scene: '${imagePrompt}' in japanese anime style. If the scene contains a first-person perspective, the image should render a high-school girl with long black hair, brown eyes.`,
            n: 1,
            size: "1024x1024",
        });

        const imageUrl = response.data?.[0]?.url;
        if (!imageUrl) {
            console.error(
                "OpenAI did not return an image URL."
            );
            return null;
        }

        // Download the image to a temporary file
        const tempFileName = `ai_image_${uuidv4()}.png`;
        const tempFilePath = path.join(
            __dirname,
            tempFileName
        );

        const imageResponse = await axios.get(imageUrl, {
            responseType: "arraybuffer",
        });
        fs.writeFileSync(tempFilePath, imageResponse.data);
        console.log(
            "AI Image generated and saved to:",
            tempFilePath
        );

        return tempFilePath;
    } catch (error) {
        console.error("Error generating AI image:", error);
        return null;
    }
}

// Function to post a tweet (text only)
async function postTweet(status) {
    console.log("Attempting to post text-only tweet...");
    try {
        await twitterClient.v2.tweet(status);
        console.log("Tweet posted successfully:", status);
    } catch (error) {
        console.error("Error posting tweet:", error);
    }
}

// Function to post a tweet with an image
async function postTweetWithImage(content, imagePath) {
    console.log(
        "Attempting to post tweet with image:",
        imagePath
    );
    try {
        const mediaId = await twitterClient.v1.uploadMedia(
            imagePath
        );
        console.log(
            "Media uploaded successfully. Media ID:",
            mediaId
        );
        await twitterClient.v2.tweet({
            text: content,
            media: { media_ids: [mediaId] },
        });
        console.log(
            "Tweet with image posted successfully:",
            content
        );
    } catch (error) {
        console.error(
            "Error posting tweet with image:",
            error
        );
    } finally {
        // If we used a temp AI image, we can remove it
        if (
            imagePath.includes("ai_image_") &&
            fs.existsSync(imagePath)
        ) {
            fs.unlinkSync(imagePath);
            console.log(
                "Temporary AI image file removed:",
                imagePath
            );
        }
    }
}

// Main function to handle tweet generation and posting
async function handleTweetPosting() {
    console.log("Handling tweet posting process...");
    const content = await generateContent(topic);
    if (!content) {
        console.error(
            "No content generated. Skipping this round."
        );
        return;
    }

    // // Decide whether to use AI image generation
    // const useAiImage =
    //     Math.random() < generateAiImageProbability;
    // console.log(
    //     "Will attempt to use AI image generation?",
    //     useAiImage
    // );

    // if (useAiImage) {
    //     const imagePrompt = await generateImagePrompt(
    //         content
    //     );
    //     if (imagePrompt) {
    //         const aiImagePath = await generateAIImage(
    //             imagePrompt
    //         );
    //         if (aiImagePath) {
    //             await postTweetWithImage(
    //                 content,
    //                 aiImagePath
    //             );
    //             return;
    //         } else {
    //             console.log(
    //                 "AI image generation failed, fallback to text only..."
    //             );
    //         }
    //     } else {
    //         console.log(
    //             "Image prompt generation failed, fallback to text only..."
    //         );
    //     }
    // }

    // If we do not use AI image or generation failed, post text only
    console.log("Posting text-only tweet...");
    await postTweet(content);
}

// Set up cron job to post tweets periodically
const cronExpression =
    process.env.POST_INTERVAL_CRON || "0 * * * *";
console.log("Cron expression set to:", cronExpression);

cron.schedule(cronExpression, async () => {
    console.log(
        `Cron job triggered at ${new Date().toISOString()}`
    );
    await handleTweetPosting();
});

console.log("Twitter GPT poster is running...");

// Execute once immediately
await handleTweetPosting();
