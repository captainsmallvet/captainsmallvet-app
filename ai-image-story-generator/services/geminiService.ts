
// Fix: Implement all Gemini service functions used by the application, as this file was previously empty.
import { GoogleGenAI, Modality, Part } from "@google/genai";
import { STYLE_PROMPT_PREFIXES, ImageStyleKey, ImageModelKey, AspectRatio, StoryLanguageKey, StoryStyleKey } from "../constants";

// Helper to parse base64 data URL
const parseDataUrl = (dataUrl: string): { mimeType: string, data: string } => {
    const [header, data] = dataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/png';
    return { mimeType, data };
};

export const generateFromText = async (
    prompt: string,
    count: 1 | 4,
    aspectRatio: AspectRatio,
    style: ImageStyleKey,
    model: ImageModelKey
): Promise<string[]> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const fullPrompt = `${STYLE_PROMPT_PREFIXES[style]} ${prompt}`;

    if (model === 'imagen-4.0-generate-001') {
        const response = await ai.models.generateImages({
            model,
            prompt: fullPrompt,
            config: {
                numberOfImages: count,
                aspectRatio,
                outputMimeType: 'image/png',
            },
        });
        return response.generatedImages.map(img => `data:image/png;base64,${img.image.imageBytes}`);
    } else if (model === 'gemini-2.5-flash-image' || model === 'gemini-3-pro-image-preview') {
        const response = await ai.models.generateContent({
            model,
            contents: { parts: [{ text: fullPrompt }] },
            config: {
                responseModalities: [Modality.IMAGE],
                imageConfig: {
                    aspectRatio: aspectRatio,
                }
            },
        });
        
        const images: string[] = [];
        for (const part of response.candidates?.[0]?.content?.parts ?? []) {
            if (part.inlineData) {
                images.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
            }
        }
        if (images.length === 0) {
            throw new Error(`Image generation failed with ${model}. No image was returned.`);
        }
        return images;
    }

    throw new Error(`Unsupported model: ${model}`);
};

export const generateFromImageAndText = async (prompt: string, referenceImages: string[]): Promise<string[]> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const parts: Part[] = [];

    for (const refImage of referenceImages) {
        const { mimeType, data } = parseDataUrl(refImage);
        parts.push({ inlineData: { mimeType, data } });
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts },
        config: {
            responseModalities: [Modality.IMAGE],
        },
    });

    const images: string[] = [];
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData) {
            images.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
        }
    }
    if (images.length === 0) {
        throw new Error("Image generation failed. No image was returned.");
    }
    return images;
};

export const describeImage = async (imageSrc: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const { mimeType, data } = parseDataUrl(imageSrc);
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { inlineData: { mimeType, data } },
                { text: "Describe this image in detail. Focus on creating a descriptive prompt that could be used for a text-to-image AI." }
            ]
        },
    });
    return response.text;
};

export const suggestCaption = async (imageSrc: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const { mimeType, data } = parseDataUrl(imageSrc);
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
            parts: [
                { inlineData: { mimeType, data } },
                { text: "Suggest a short, witty, and engaging caption for this image suitable for social media. Respond with only the caption text." }
            ]
        },
    });
    return response.text.replace(/["']/g, ""); // Clean up quotes
};

export const enhancePrompt = async (prompt: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Enhance the following text-to-image prompt to make it more vivid, detailed, and imaginative. Return only the enhanced prompt itself, without any extra text or explanation.\n\nOriginal prompt: "${prompt}"`,
    });
    return response.text.replace(/["']/g, "");
};

export const generateConcept = async (story: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Read the following story and generate a single, concise text-to-image prompt that captures the most visually striking scene or core concept. The prompt should be highly descriptive and suitable for an AI image generator. Return only the prompt.\n\nStory: "${story}"`,
    });
    return response.text;
};

export const expandImage = (imageSrc: string, targetAspectRatio: AspectRatio): Promise<string[]> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
            const originalWidth = img.width;
            const originalHeight = img.height;
            const originalRatio = originalWidth / originalHeight;

            const [targetW, targetH] = targetAspectRatio.split(':').map(Number);
            const targetRatio = targetW / targetH;

            const canvas = document.createElement('canvas');
            let xOffset = 0;
            let yOffset = 0;

            if (targetRatio > originalRatio) {
                // Expand horizontally
                canvas.height = originalHeight;
                canvas.width = Math.round(originalHeight * targetRatio);
                xOffset = (canvas.width - originalWidth) / 2;
                yOffset = 0;
            } else {
                // Expand vertically
                canvas.width = originalWidth;
                canvas.height = Math.round(originalWidth / targetRatio);
                xOffset = 0;
                yOffset = (canvas.height - originalHeight) / 2;
            }


            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Could not get canvas context'));
            }

            ctx.drawImage(img, xOffset, yOffset, originalWidth, originalHeight);

            const compositeImageBase64 = canvas.toDataURL('image/png');
            const { mimeType, data } = parseDataUrl(compositeImageBase64);
            const prompt = `This is a composite image with a central picture and transparent areas. Fill in the transparent areas to expand the scene into a seamless ${targetAspectRatio} image. Match the style, lighting, and content of the original central image perfectly.`;

            try {
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: {
                        parts: [
                            { inlineData: { mimeType, data } },
                            { text: prompt }
                        ]
                    },
                    config: {
                        responseModalities: [Modality.IMAGE],
                    },
                });

                const images: string[] = [];
                for (const part of response.candidates?.[0]?.content?.parts ?? []) {
                    if (part.inlineData) {
                        images.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
                    }
                }

                if (images.length > 0) {
                    resolve(images);
                } else {
                    reject(new Error("Image expansion failed. No image was returned."));
                }
            } catch (error) {
                reject(error);
            }
        };
        img.onerror = () => {
            reject(new Error('Failed to load image for expansion.'));
        };
        img.src = imageSrc;
    });
};


export const generateNextSentence = async (
    story: string,
    language: StoryLanguageKey,
    style: StoryStyleKey
): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const langMap: Record<StoryLanguageKey, string> = {
        thai: 'Thai',
        english: 'English',
        contextual: 'Thai or English, whichever is more appropriate for the story',
    };

    const styleMap: Record<StoryStyleKey, string> = {
        unspecified: "continue the story in a consistent and engaging way.",
        twist: "introduce a surprising plot twist that readers would not expect.",
        example: "provide a clear example to illustrate the previous point.",
        mystery: "deepen the mystery, adding a new clue or question.",
        motto: "introduce a short, inspirational Buddhist motto or quote that reflects on the story.",
        kids_tale: "continue the story in a whimsical, imaginative, and child-friendly manner.",
        academic_dharma: "explain a Buddhist concept relevant to the story in an academic, clear, and insightful way.",
        dharma_novel: "weave a Buddhist teaching or moral into the narrative in a subtle, story-driven way.",
        casual_dharma: "continue the conversation in a friendly, warm tone, like a friend sharing Dharma wisdom.",
        academic: "explain a concept relevant to the story in an academic, insightful way, with clarity.",
        english_teacher: "explain an English grammar point or vocabulary from the story, as a helpful teacher would.",
        comforting: "offer words of comfort and encouragement that feel genuine and uplifting.",
        thai_poem: `แต่งกลอนแปดแบบไทย (กลอนสุภาพ) หนึ่งบทเพื่อดำเนินเรื่องต่อ โดยต้องแต่งครั้งละหนึ่งบท (4 วรรค) ตามรูปแบบที่กำหนดอย่างเคร่งครัด:
- **โครงสร้าง**: กลอนแปดหนึ่งบทประกอบด้วย 4 วรรค (วรรคสดับ, วรรครับ, วรรครอง, และวรรคส่ง)
- **จำนวนคำ**: แต่ละวรรคมี 7-9 คำ (ส่วนใหญ่จะใช้ 8 คำเพื่อความไพเราะ)
- **สัมผัสนอก (บังคับ)**:
  - คำสุดท้ายของวรรคสดับ สัมผัสกับคำที่ 3 หรือ 5 ของวรรครับ
  - คำสุดท้ายของวรรครับ สัมผัสกับคำสุดท้ายของวรรครอง และคำที่ 3 หรือ 5 ของวรรคส่ง
- **สัมผัสระหว่างบท**: หากมีบทกลอนอยู่แล้วใน "STORY SO FAR" คำสุดท้ายของวรรครับของบทใหม่ที่แต่งนี้ ต้องสัมผัสกับคำสุดท้ายของวรรคส่งของบทก่อนหน้า
- **เสียงท้ายวรรค (บังคับ)**:
  - วรรคสดับ: ใช้ได้ทุกเสียง แต่ไม่นิยมเสียงสามัญ
  - วรรครับ: ไม่นิยมใช้เสียงสามัญและเสียงตรี
  - วรรครอง: นิยมใช้เพียงเสียงสามัญและเสียงตรี
  - วรรคส่ง: นิยมใช้เพียงเสียงสามัญและเสียงตรี
- **สัมผัสใน**: ใช้สัมผัสสระและอักษรในแต่ละวรรคเพื่อเพิ่มความไพเราะ
- **คำสั่งสุดท้าย**: ให้แต่งและตอบกลับเป็นบทกลอน 4 วรรคเท่านั้น โดยไม่ต้องมีคำอธิบายหรือข้อความอื่นใดนำหน้าหรือต่อท้าย`,
        romance_novel: "add a romantic and dreamy development to the plot.",
        sci_fi_novel: "introduce a creative science fiction element or concept.",
        horror_novel: "build suspense and horror, making the story more frightening.",
        lighthearted_comedy: "สวมบทบาทเป็นนักเล่าเรื่องตลกที่เก่งกาจ มีอารมณ์​ขัน อารมณ์ดี​ ร่ำรวยมุขตลก แต่งเรื่องราวได้อย่างตลก ขบขัน เบาสมอง มีความคิดสร้างสรรค์​ แปลกใหม่ แหวกแนว จนคนฟังคาดไม่ถึง สนุกสนานเฮฮา เพลิดเพลิน น่าติดตาม โดยไม่ใช้คำยาบ ไม่ลามก แต่เป็นตลกแบบสร้างสรรค์​ สุภาพ",
        inspiration: "สวมบทบาทเป็นนักพูดสร้างแรงบันดาลใจ (Motivational Speaker) ที่เก่งกาจ มีความสามารถในการพูดที่สามารถกระตุ้น และจุดประกาย ให้ผู้ฟังเกิดความรู้สึกมีกำลังใจ, มีพลัง, และมีความปรารถนา ที่จะลงมือทำบางสิ่งบางอย่าง หรือเกิดการเปลี่ยนแปลงไปในทางที่ดีขึ้น พูดให้ผู้ฟังรู้สึกมีพลังและกำลังใจมากขึ้นกว่าเดิม กระตุ้นให้เกิดความรู้สึกเชิงบวก โดยเฉพาะอย่างยิ่งการทำสิ่งที่เป็นสร้างสรรค์ กระตุ้นให้ผู้ฟังเกิดแรงจูงใจภายใน (Inner Drive) เพื่อให้บรรลุเป้าหมายหรือความสำเร็จที่ต้องการ เพื่อให้ผู้ฟังเชื่อมั่นในตัวเอง และเห็นคุณค่าในตนเอง ว่าพวกเขาสามารถเอาชนะปัญหา และก้าวไปสู่ความสำเร็จได้",
        analysis: "สวมบทบาทเป็นนักวิเคราะห์ที่เก่งกาจ ชาญฉลาด หลักแหลม มีความรู้ความเข้าใจในเนื้อหาที่กำลังดำเนินอยู่นั้นอย่างลึกซึ้ง ครบถ้วน รอบด้าน มีความสามารถในการพูดให้ผู้ฟังเข้าใจได้อย่างละเอียด ลึกซึ้ง เข้าใจเหตุผลที่มาที่ไปครบถ้วนทุกแง่มุม พูดวิเคราะห์ อธิบาย แยกแยะข้อมูล สถิติ และข้อเท็จจริงอย่างเป็นระบบ เพื่ออธิบายหัวข้อที่ซับซ้อนให้เข้าใจง่าย",
        adventure: "สวมบทบาทเป็นนักเล่าเรื่องแนวผจญภัย บู้ ตื่นเต้น ที่เก่งกาจ มีความสามารถในการพูดให้ผู้ฟังรู้สึกตื่นเต้น มีอารมณ์ร่วมกับเหตุการณ์นั้น เหมือนกับกำลังผจญภัยอยู่ในเหตุการณ์นั้นด้วยตัวเองจริงๆ พูดเรื่องที่กำลังดำเนินอยู่นั้นอย่างออกรสชาติ จนผู้ฟังฟังอย่างใจจดใจจ่อ ไม่อาจละความสนใจไปได้",
        tear_jerker: "สวมบทบาทเป็นนักเล่าเรื่องเศร้าเคล้าน้ำตา ที่มีจิตวิทยาสูง เล่าเรื่องให้ผู้ฟังคล้อยตามจนน้ำตาไหลพราก สงสารจับใจ",
        beyond_imagination: "สวมบทบาทเป็นนักเล่าเรื่องเหนือจินตนาการของผู้ฟัง จนผู้ฟังอ้าปากค้าง",
    };

    const prompt = `You are an expert, creative storyteller.
Analyze the following story:
--- STORY SO FAR ---
${story || "(The story is empty. Please start a new story.)"}
--- END OF STORY ---
Your task is to create ONLY the very next single sentence to continue the story.
- The language of the new sentence MUST be: ${langMap[language]}.
- The style of the new sentence MUST be to: ${styleMap[style]}.
- IMPORTANT: Respond with ONLY the single new sentence and nothing else. Do not add any explanation, labels, or quotation marks.`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
    });
    return response.text.trim();
};

export const generateStoryCaption = async (story: string, language: 'English' | 'Thai' = 'English'): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const langInstruction = language === 'Thai' ? 'Thai' : 'English';
    
    const prompt = `Analyze the following story. Your task is to summarize the entire story's core message, moral, or key takeaway into a single, beautiful, and impactful sentence in ${langInstruction}.
- The sentence must be in simple, easy-to-understand ${langInstruction}.
- It must be concise and memorable.
- The total length of the caption text must not exceed 60 characters.
- Do NOT use any special characters or emojis.
- Do NOT use quotation marks.
- Respond with ONLY the single ${langInstruction} sentence.

--- STORY ---
${story}
--- END OF STORY ---
`;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });
    return response.text.trim();
};

export const polishStory = async (story: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `You are a professional editor with an expert command of language and storytelling.
Your task is to take the following raw text and rewrite it to be more elegant, coherent, and engaging.
- Improve the flow and pacing.
- Correct any grammatical errors or awkward phrasing.
- Enhance the vocabulary and sentence structure.
- Ensure the narrative is clear and compelling.
- IMPORTANT: Preserve the original plot, characters, and author's intent. Do not change the core story.
- Respond with ONLY the fully polished story. Do not add any introductory or concluding remarks.

--- RAW TEXT ---
${story}
--- END OF RAW TEXT ---
`;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
    });
    return response.text.trim();
};

export const translateStory = async (story: string, targetLanguage: 'Thai' | 'English'): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const prompt = `You are an expert translator.
Translate the following text into ${targetLanguage}.
- Provide only the translated text as the response.
- Do not add any introductory phrases, explanations, or quotation marks.
- Ensure the translation is natural, accurate, and maintains the original tone.

--- TEXT TO TRANSLATE ---
${story}
--- END OF TEXT ---
`;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt,
    });
    return response.text.trim();
};

export const generateDesignFromStory = async (story: string, styleName: string): Promise<string> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Read the following story. Design a creative, beautiful, and attractive image composition that captures the essence of this story. The design must be optimized for the artistic style: "${styleName}".
Create a concise but descriptive text-to-image prompt for this image.
Respond with ONLY the prompt description text.

--- STORY ---
${story}`,
    });
    return response.text.trim();
};
