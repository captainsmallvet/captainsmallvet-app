
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { generateFromText, generateFromImageAndText, describeImage, suggestCaption, enhancePrompt, generateConcept, expandImage } from './services/geminiService';
import { ASPECT_RATIOS, IMAGE_STYLES, IMAGE_MODELS, AspectRatio, ImageStyleKey, ImageModelKey } from './constants';
import Spinner from './components/Spinner';
import ImagePlaceholder from './components/ImagePlaceholder';
import ReferenceImages from './components/ReferenceImages';
import ImageCard from './components/ImageCard';
import { blobToBase64 } from './utils/imageUtils';
import PromptActions from './components/PromptActions';
import StoryWriter from './components/StoryWriter';

declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
}

const App: React.FC = () => {
    const [prompt, setPrompt] = useState<string>('');
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
    const [style, setStyle] = useState<ImageStyleKey>('photorealistic');
    const [model, setModel] = useState<ImageModelKey>('gemini-2.5-flash-image');
    const [images, setImages] = useState<string[]>([]);
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingCount, setLoadingCount] = useState<number>(0);
    const [processingAction, setProcessingAction] = useState<string | null>(null);
    const [promptActionLoading, setPromptActionLoading] = useState<string | null>(null);
    const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const isValidModel = IMAGE_MODELS.some(m => m.key === model);
        if (!isValidModel) {
            setModel('gemini-2.5-flash-image');
        }
    }, [model]);

    const handleGenerate = useCallback(async (count: 1 | 4) => {
        if (!prompt.trim()) {
            setError("Please enter a prompt.");
            return;
        }

        // API Key selection for paid models
        if (model === 'gemini-3-pro-image-preview') {
            try {
                const hasKey = await window.aistudio.hasSelectedApiKey();
                if (!hasKey) {
                    await window.aistudio.openSelectKey();
                }
            } catch (err) {
                setError("Failed to select API key.");
                return;
            }
        }

        setLoading(true);
        setError(null);
        setImages([]);
        
        const isGeminiModel = model === 'gemini-2.5-flash-image' || model === 'gemini-3-pro-image-preview';
        let effectiveCount = (referenceImages.length > 0 || isGeminiModel) ? 1 : count;
        setLoadingCount(effectiveCount);


        try {
            let generatedImages: string[];
            if (referenceImages.length > 0) {
                 generatedImages = await generateFromImageAndText(prompt, referenceImages);
            } else {
                 generatedImages = await generateFromText(prompt, effectiveCount as 1 | 4, aspectRatio, style, model);
            }
            setImages(generatedImages);
        } catch (err) {
            if (err instanceof Error) {
                if (err.message.includes("Requested entity was not found")) {
                     try {
                        await window.aistudio.openSelectKey();
                        setError("Session expired or invalid key. Please try generating again.");
                    } catch (e) {
                        setError("API Key Error: Please select a valid key.");
                    }
                } else {
                    setError(err.message);
                }
            } else {
                setError("An unknown error occurred.");
            }
        } finally {
            setLoading(false);
            setLoadingCount(0);
        }
    }, [prompt, aspectRatio, style, model, referenceImages]);

    const handleSetReference = useCallback((imageSrc: string) => {
        if (referenceImages.length < 4) {
            setReferenceImages(prev => [...prev, imageSrc]);
        } else {
            setError("You can only have a maximum of 4 reference images.");
        }
    }, [referenceImages.length]);
    
    const handleRemoveReference = useCallback((indexToRemove: number) => {
        setReferenceImages(prev => prev.filter((_, index) => index !== indexToRemove));
    }, []);

    const handleUploadReference = useCallback(async (file: File) => {
        if (!file.type.startsWith('image/')) {
            setError("Please upload a valid image file.");
            return;
        }
        try {
            const base64 = await blobToBase64(file);
            handleSetReference(base64 as string);
        } catch (err) {
            setError("Failed to read the image file.");
        }
    }, [handleSetReference]);

    const handleInsertRefTag = useCallback((tag: string) => {
        const textarea = promptTextareaRef.current;
        if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            const newText = `${text.substring(0, start)} ${tag} ${text.substring(end)}`;
            setPrompt(newText);
            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = start + tag.length + 2;
        }
    }, []);

    const handleDescribe = useCallback(async (imageSrc: string, index: number) => {
        setProcessingAction(`describe-${index}`);
        setError(null);
        try {
            const description = await describeImage(imageSrc);
            setPrompt(description);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setProcessingAction(null);
        }
    }, []);
    
    const handleCaption = useCallback(async (imageSrc: string, index: number) => {
        setProcessingAction(`caption-${index}`);
        setError(null);
        try {
            const caption = await suggestCaption(imageSrc);
            setReferenceImages([imageSrc]);
            setPrompt(`Recreate the image in [ref-1], but add the following text as a caption: "${caption}". The caption should be elegantly placed in a suitable position, using a beautiful font with a color that is easily readable against the background. Do not obscure important details like faces or key subjects. The text should be clear and readable on a mobile screen.`);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setProcessingAction(null);
        }
    }, []);
    
    const handleRemoveText = useCallback(async (imageSrc: string, index: number) => {
        setProcessingAction(`remove-text-${index}`);
        setError(null);
        
        const newPrompt = `Analyze the image provided in [ref-1] and remove all text, words, characters and logos. Reconstruct the areas where the text was removed to look natural and seamless with the rest of the image.`;
        const newReferenceImages = [imageSrc];

        setPrompt(newPrompt);
        setReferenceImages(newReferenceImages);
        
        setLoading(true);
        setImages([]);
        setLoadingCount(1);

        try {
            const generatedImages = await generateFromImageAndText(newPrompt, newReferenceImages);
            setImages(generatedImages);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
            setLoadingCount(0);
            setProcessingAction(null);
        }
    }, []);

    const handleExpandImage = useCallback(async (imageSrc: string, index: number, targetAspectRatio: AspectRatio) => {
        setProcessingAction(`expand-${index}`);
        setLoading(true);
        setError(null);
        setImages([]);
        setLoadingCount(1);
        setAspectRatio(targetAspectRatio); // Set aspect ratio for the placeholder

        try {
            const expandedImages = await expandImage(imageSrc, targetAspectRatio);
            setImages(expandedImages);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
            setLoadingCount(0);
            setProcessingAction(null);
            setAspectRatio('16:9'); // Reset aspect ratio for the next generation
        }
    }, []);

    const handleCopyPrompt = () => {
        if (!prompt.trim()) return;
        navigator.clipboard.writeText(prompt);
    };

    const handleClearPrompt = () => {
        setPrompt('');
    };

    const handleDescribeRef1 = useCallback(async () => {
        if (referenceImages.length === 0) {
            setError("No reference image available to describe.");
            return;
        }
        setPromptActionLoading('describe-ref-1');
        setError(null);
        try {
            const description = await describeImage(referenceImages[0]);
            setPrompt(description);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setPromptActionLoading(null);
        }
    }, [referenceImages]);

    const handleCaptionRef1 = useCallback(async () => {
        if (referenceImages.length === 0) {
            setError("No reference image available to caption.");
            return;
        }
        setPromptActionLoading('caption-ref-1');
        setError(null);
        try {
            const caption = await suggestCaption(referenceImages[0]);
            setReferenceImages([referenceImages[0]]);
            setPrompt(`Recreate the image in [ref-1], but add the following text as a caption: "${caption}". The caption should be elegantly placed in a suitable position, using a beautiful font with a color that is easily readable against the background. Do not obscure important details like faces or key subjects. The text should be clear and readable on a mobile screen.`);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setPromptActionLoading(null);
        }
    }, [referenceImages]);

    const handleRemoveTextRef1 = useCallback(async () => {
        if (referenceImages.length === 0) {
            setError("No reference image available to process.");
            return;
        }
        setPromptActionLoading('remove-text-ref-1');
        setError(null);
        
        const newPrompt = `Analyze the image provided in [ref-1] and remove all text, words, characters and logos. Reconstruct the areas where the text was removed to look natural and seamless with the rest of the image.`;
        const newReferenceImages = [referenceImages[0]];

        setPrompt(newPrompt);
        setReferenceImages(newReferenceImages);
        
        setLoading(true);
        setImages([]);
        setLoadingCount(1);

        try {
            const generatedImages = await generateFromImageAndText(newPrompt, newReferenceImages);
            setImages(generatedImages);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
            setLoadingCount(0);
            setPromptActionLoading(null);
        }
    }, [referenceImages]);

    const handleExpandRef1 = useCallback(async (targetAspectRatio: AspectRatio) => {
        if (referenceImages.length === 0) {
            setError("No reference image available to expand.");
            return;
        }
        setPromptActionLoading('expand-ref-1');
        setLoading(true);
        setError(null);
        setImages([]);
        setLoadingCount(1);
        setAspectRatio(targetAspectRatio);
    
        try {
            const expandedImages = await expandImage(referenceImages[0], targetAspectRatio);
            setImages(expandedImages);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
            setLoadingCount(0);
            setPromptActionLoading(null);
            setAspectRatio('16:9'); // Reset aspect ratio
        }
    }, [referenceImages]);

    const handleEnhancePrompt = useCallback(async () => {
        if (!prompt.trim()) {
            setError("Prompt is empty, nothing to enhance.");
            return;
        }
        setPromptActionLoading('enhance');
        setError(null);
        try {
            const enhanced = await enhancePrompt(prompt);
            setPrompt(enhanced);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setPromptActionLoading(null);
        }
    }, [prompt]);

    const handleConcept = useCallback(async () => {
        if (!prompt.trim()) {
            setError("Prompt is empty, cannot generate concept.");
            return;
        }
        setPromptActionLoading('concept');
        setError(null);
        try {
            const concept = await generateConcept(prompt);
            setPrompt(concept);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setPromptActionLoading(null);
        }
    }, [prompt]);

    const handlePostStoryToPrompt = useCallback((storyText: string) => {
        setPrompt(storyText);
        // smooth scroll to the top of the controls section
        const controlsElement = document.getElementById('controls');
        if (controlsElement) {
            controlsElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    const renderImageGrid = () => {
        if (loading) {
            return (
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-5xl mx-auto">
                    {Array.from({ length: loadingCount }).map((_, index) => (
                        <ImagePlaceholder key={index} aspectRatio={aspectRatio} />
                    ))}
                </div>
            );
        }

        if (images.length > 0) {
            const gridCols = images.length === 1 ? 'grid-cols-1' : 'sm:grid-cols-2';
            const maxW = images.length === 1 ? 'max-w-3xl' : 'max-w-5xl';
            
            return (
                <div className={`grid ${gridCols} gap-6 w-full ${maxW} mx-auto`}>
                    {images.map((src, index) => (
                        <ImageCard
                            key={index}
                            src={src}
                            index={index}
                            aspectRatio={aspectRatio}
                            processingAction={processingAction}
                            onEdit={handleSetReference}
                            onDescribe={handleDescribe}
                            onCaption={handleCaption}
                            onRemoveText={handleRemoveText}
                            onExpand={handleExpandImage}
                         />
                    ))}
                </div>
            );
        }

        return (
            <div className="w-full max-w-5xl mx-auto flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-700 rounded-lg text-center text-gray-500 min-h-[300px] sm:min-h-[400px]">
                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <h2 className="mt-4 text-2xl font-semibold text-gray-300">Your Creations Will Appear Here</h2>
                <p className="mt-2 text-gray-400">Enter a prompt below and let your imagination run wild!</p>
            </div>
        );
    };

    const isGeminiModel = model === 'gemini-2.5-flash-image' || model === 'gemini-3-pro-image-preview';

    return (
        <div className="bg-gray-900 text-white min-h-screen">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <header className="text-center mb-10">
                    <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-500 pb-2">
                        AI Image & Story Generator
                    </h1>
                    <p className="mt-3 text-lg text-gray-300">
                        stunning high-quality visuals & amazing stories by Thunyaluk AI
                    </p>
                </header>

                <main className="mb-10">
                    {renderImageGrid()}
                </main>

                <section id="controls" className="bg-gray-800/50 backdrop-blur-md rounded-lg p-4 sm:p-6 shadow-xl max-w-4xl mx-auto border border-gray-700">
                    {error && (
                        <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-4 text-sm flex items-center" role="alert">
                             <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"></path></svg>
                            <div><span className="font-bold">Error:</span> {error}</div>
                        </div>
                    )}
                    
                    <ReferenceImages 
                        images={referenceImages}
                        onRemove={handleRemoveReference}
                        onUpload={handleUploadReference}
                        onInsertTag={handleInsertRefTag}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label htmlFor="aspectRatio" className="block text-sm font-medium text-gray-300 mb-1">Aspect Ratio</label>
                            <select
                                id="aspectRatio"
                                value={aspectRatio}
                                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                                className="w-full bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                                disabled={loading || referenceImages.length > 0}
                            >
                                {ASPECT_RATIOS.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="style" className="block text-sm font-medium text-gray-300 mb-1">Image Style</label>
                            <select
                                id="style"
                                value={style}
                                onChange={(e) => setStyle(e.target.value as ImageStyleKey)}
                                className="w-full bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                                disabled={loading || referenceImages.length > 0}
                            >
                                {IMAGE_STYLES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                            </select>
                        </div>
                    </div>
                    
                    <PromptActions
                        prompt={prompt}
                        hasReferenceImage={referenceImages.length > 0}
                        onCopy={handleCopyPrompt}
                        onClear={handleClearPrompt}
                        onDescribe={handleDescribeRef1}
                        onCaption={handleCaptionRef1}
                        onRemoveText={handleRemoveTextRef1}
                        onExpand={handleExpandRef1}
                        onEnhance={handleEnhancePrompt}
                        onConcept={handleConcept}
                        loadingAction={promptActionLoading}
                    />

                    {referenceImages.length > 0 && (
                        <p className="text-xs text-yellow-400/80 mb-4 text-center">Image Model, Style and Aspect Ratio are disabled when using reference images.</p>
                    )}
                     {(isGeminiModel && referenceImages.length === 0) && (
                        <p className="text-xs text-yellow-400/80 -mt-2 mb-4 text-center">For the Gemini models, 4-image generation is unavailable.</p>
                    )}
                    
                    <textarea
                        ref={promptTextareaRef}
                        rows={5}
                        className="w-full bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 placeholder-gray-400 resize-none mb-4"
                        placeholder="e.g., A majestic lion wearing a crown, sitting on a throne in a futuristic jungle..."
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        disabled={loading || !!promptActionLoading}
                    />

                     <div className="mb-4">
                        <label htmlFor="model" className="block text-sm font-medium text-gray-300 mb-1">Image Model</label>
                        <select
                            id="model"
                            value={model}
                            onChange={(e) => setModel(e.target.value as ImageModelKey)}
                            className="w-full bg-gray-700 border-gray-600 text-white rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                            disabled={loading || referenceImages.length > 0}
                        >
                            {IMAGE_MODELS.map(m => <option key={m.key} value={m.key}>{m.name}</option>)}
                        </select>
                    </div>
                    
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                            onClick={() => handleGenerate(1)}
                            disabled={loading || !prompt.trim()}
                            className={`flex items-center justify-center w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-md transition-all duration-300 ease-in-out transform hover:scale-105 disabled:scale-100 ${
                                (isGeminiModel || referenceImages.length > 0) ? 'sm:col-span-2' : ''
                            }`}
                        >
                            {loading && loadingCount === 1 ? <Spinner /> : `Generate`}
                        </button>
                        {!(isGeminiModel || referenceImages.length > 0) && (
                             <button
                                onClick={() => handleGenerate(4)}
                                disabled={loading || !prompt.trim()}
                                className="flex items-center justify-center w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-md transition-all duration-300 ease-in-out transform hover:scale-105 disabled:scale-100"
                            >
                                {loading && loadingCount === 4 ? <Spinner /> : 'Generate 4 Images'}
                            </button>
                        )}
                    </div>
                    <StoryWriter onPostToPrompt={handlePostStoryToPrompt} selectedStyle={style} />
                </section>
            </div>
        </div>
    );
};

export default App;
