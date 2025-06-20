import { FOLDER_ICONS } from '@/constraints';
import { LibraryItem } from '@/database/schemas';
import { MessageDto } from '@/modules/chat/chat.dto';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { PromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutputFixingParser, StructuredOutputParser } from 'langchain/output_parsers';
import { z } from 'zod';

@Injectable()
export class GenAIService {
    private genAI: ChatGoogleGenerativeAI;
    private gptAi: ChatOpenAI;

    constructor(private readonly configService: ConfigService) {
        this.initializeGenAI();
    }

    private initializeGenAI() {
        this.genAI = new ChatGoogleGenerativeAI({
            apiKey: this.configService.get<string>('gemini.apiKey'),
            model: 'gemini-2.0-flash',
            temperature: 0.7,
            maxOutputTokens: 2048,
        });
    }

    async generateResponse(message: string) {
        try {
            const response = await this.genAI.invoke([new HumanMessage(message)]);
            return response.text;
        } catch (error) {
            throw new HttpException('Failed to generate response', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateContextualResponse(chatHistory: MessageDto[] = []) {
        try {
            const prevMessages = chatHistory.map(message => {
                switch (message.role) {
                    case 'USER':
                        return new HumanMessage(message.message);
                    case 'ASSISTANT':
                        return new AIMessage(message.message);
                }
            });

            const systemPrompt = new SystemMessage(`You are StudyMind AI, an educational assistant. 
            Provide helpful, educational responses that:
            - Build upon previous conversation context
            - Maintain educational focus
            - Reference previous topics when relevant
            - Guide learning progression naturally
            - Offer to create study materials when appropriate`);

            const response = await this.genAI.invoke([systemPrompt, ...prevMessages]);

            console.log('Contextual response:', response.text);
            return response.text;
        } catch (error) {
            throw new HttpException('Failed to generate contextual response', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateSummary(chatHistory: MessageDto[]) {
        if (chatHistory.length === 0) return '';

        const recentConversation = chatHistory
            .slice(-6)
            .map(msg => `${msg.role}: ${msg.message}`)
            .join('\n');

        try {
            const response = await this.genAI.invoke([
                new SystemMessage(`Summarize the key context from this conversation in a few sentences. Focus on: 
                - Main topics discussed
                - Any content created or referenced
                - Current learning goals or questions
                - Educational subject areas`),
                new HumanMessage(`Conversation:\n${recentConversation}`),
            ]);

            console.log('Summary:', response.text);
            return response.text;
        } catch (error) {
            return new HttpException('Failed to summarize context', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateInitialDecision(chatHistory: MessageDto[]) {
        try {
            const InitialDecisionSchema = z.object({
                // Session info
                title: z.string().optional(),
                description: z.string().optional(),
                // Initial decision
                action: z.enum(['CHAT', 'READ', 'CREATE']),
                intent: z.string(),
                confidence: z.number().min(0).max(1),
                references: z.array(z.object({ uid: z.string(), name: z.string(), type: z.string() })).optional(),
            });

            const currentMessage = chatHistory[chatHistory.length - 1].message;
            const outputParser = OutputFixingParser.fromLLM(this.genAI, StructuredOutputParser.fromZodSchema(InitialDecisionSchema));
            const contextSummary = await this.generateSummary(chatHistory.slice(0, -1));

            const promptTemplate = new PromptTemplate({
                template: `You are StudyMind AI, an educational assistant. Analyze the user's intent and provide appropriate decisions. 

                CONVERSATION CONTEXT: {contextSummary}
                CURRENT MESSAGE: {message}

                SESSION GENERATION GUIDELINES:
                - Title: Be specific and educational-focused (e.g., "Calculus Derivatives Help" not "Math Question")
                - Description: Capture the user's learning intent and subject area

                ACTION DEFINITIONS:
                - READ: User references existing content (@mention {{...}}) for analysis, discussion, or questions about it
                - CREATE: User wants to generate NEW study materials, either standalone OR from existing content (@mention {{...}})
                - CHAT: General discussions, explanations, Q&A without content creation or analysis

                MENTION FORMAT: @mention {{uid: content uid, name: content name, type: content type}} 

                DECISION LOGIC:
                1. If @mention {{...}} + creation keywords (create, make, generate, turn into, convert, build, add) → CREATE
                2. If @mention {{...}} + analysis/discussion keywords (overview, explain, discuss, understand, help with) → READ  
                3. If creation keywords without @mention {{...}} → CREATE
                4. Otherwise → CHAT

                EXAMPLES:
                - "Can you give me an overview of @mention {{...}}" → READ
                - "Can you make a note from @mention {{...}}" → CREATE
                - "Create a new folder for Math" → CREATE
                - "What is photosynthesis?" → CHAT

                {format_instructions}`,
                inputVariables: ['message', 'contextSummary'],
                partialVariables: { format_instructions: outputParser.getFormatInstructions() },
            });

            const response = await this.genAI.invoke([
                new HumanMessage(
                    await promptTemplate.format({
                        message: currentMessage,
                        contextSummary,
                    }),
                ),
            ]);

            console.log('Initial Decision', response.text);
            return await outputParser.parse(response.text);
        } catch (error) {
            throw new HttpException('Failed to generate initial decision', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateContentCreation(chatHistory: MessageDto[], references: LibraryItem[]) {
        try {
            const ContentCreationSchema = z.object({
                name: z.string(),
                type: z.enum(['FOLDER', 'NOTE', 'DOCUMENT', 'FLASHCARD', 'AUDIO', 'VIDEO', 'IMAGE']),
                parentId: z.number().nullable(),
                metadata: z
                    .object({
                        description: z.string().optional(),
                        color: z.string().optional(),
                        icon: z.enum(FOLDER_ICONS).optional(),
                        notes: z.string().optional(),
                        cards: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
                        fileType: z.string().optional(),
                        duration: z.number().optional(),
                        resolution: z.string().optional(),
                    })
                    .optional(),
                prompt: z.string().optional(),
                confidence: z.number().min(0).max(1),
            });

            const currentMessage = chatHistory[chatHistory.length - 1].message;
            const outputParser = OutputFixingParser.fromLLM(this.genAI, StructuredOutputParser.fromZodSchema(ContentCreationSchema));
            const contextSummary = await this.generateSummary(chatHistory.slice(0, -1));

            const promptTemplate = new PromptTemplate({
                template: `You are StudyMind AI, an educational assistant. Your task is to generate appropriate study content based on the user's request, adhering strictly to the provided schema and rules.

                CONVERSATION CONTEXT: {contextSummary}
                CURRENT REQUEST: {message}

                REFERENCED CONTENT:
                When user mentions @mention {{uid: uuidv4, name: History Chapter 3, type: 'NOTE'}}, the system provides corresponding content data in references array:
                {references}

                NAME RULES:
                - Use an educational and professional name for the content.
                - Names should be concise and descriptive.

                TYPE RULES:
                - Use the most appropriate type for the content (from the allowed enum, e.g., 'NOTE'), based on the user's request.

                PARENT ID RULES:
                1. If the user explicitly requests creation *inside* a specific folder (e.g., "create a note in @mention {{...}}"), use that folder's ID as parentId.
                2. If the user mentions existing content (e.g., "summarize @mention {{...}}"), use the parentId of the mentioned content.
                3. If no explicit folder mention or a general request (e.g., "create a new flashcard set"), set parentId to null.

                CONTENT TYPE SPECIFIC RULES:
                - FOLDER: Requires metadata.color (hex code, e.g., "#A8C686") and metadata.icon (from allowed enum, e.g., "book").
                - NOTE: Include a brief metadata.description. The markdown content should be in metadata.notes, structured with sections and sub-sections and formatted with headers, lists, tables. (max 1000 words).
                - FLASHCARD: Include a brief metadata.description. The flashcards should be a JSON array of {{"question":"", "answer":""}} objects in metadata.cards. Number of cards should be in metadata.cardCount. (max 10 cards).
                - DOCUMENT: Include a brief metadata.description. Set metadata.fileType to "pdf".
                - AUDIO: Include a brief metadata.description. Set metadata.fileType to "mp3". Estimate metadata.duration in seconds.
                - VIDEO: Include a brief metadata.description. Set metadata.fileType to "mp4". Estimate metadata.duration in seconds.
                - IMAGE: Include a brief metadata.description. Set metadata.fileType to "png". Provide metadata.resolution in "widthxheight" format (e.g., "1920x1080").

                PROMPT GENERATION RULES (Only for type: DOCUMENT, AUDIO, VIDEO, IMAGE):
                - DOCUMENT: Set 'prompt' to a well-structured markdown document with headers, lists, and tables (max 200 words).
                - AUDIO: Set 'prompt' to a short and natural-sounding script for speech synthesis (max 100 words).
                - VIDEO: Set 'prompt' to a clear and engaging video script for visual narration (max 100 words).
                - IMAGE: Set 'prompt' to a concise and specific image description (max 20 words).

                Do not include the 'prompt' field for other types.
                
                {format_instructions}`,
                inputVariables: ['message', 'references', 'contextSummary'],
                partialVariables: { format_instructions: outputParser.getFormatInstructions() },
            });

            const response = await this.genAI.invoke([
                new HumanMessage(
                    await promptTemplate.format({
                        message: currentMessage,
                        references: JSON.stringify(references),
                        contextSummary,
                    }),
                ),
            ]);

            console.log('Content response', response.text);
            return await outputParser.parse(response.text);
        } catch (error) {
            console.error(error);
            throw new HttpException('Failed to generate content', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    async generateContentAnalysis(chatHistory: MessageDto[]) {
        try {
            const currentMessage = chatHistory.pop().message;
            const contextSummary = await this.generateSummary(chatHistory);

            const promptTemplate = new PromptTemplate({
                template: `You are StudyMind AI, an educational assistant. Analyze the mentioned content and answer the user's question, considering our conversation context.

                CONVERSATION CONTEXT: {contextSummary}

                CURRENT QUERY: {message}
                MENTIONED CONTENT: {mentionedContent}
                CONTENT DATA: {contentData}

                INSTRUCTIONS:
                1. Reference the conversation context when relevant
                2. Connect current analysis to previous discussions
                3. Provide educational insights based on both content and context
                4. Answer questions comprehensively using all available information
                5. Suggest connections to previous topics covered
                6. Be specific and cite sources when relevant

                Provide a comprehensive, contextual educational response.`,
                inputVariables: ['message', 'contextSummary'],
            });

            const response = await this.genAI.invoke([
                new HumanMessage(
                    await promptTemplate.format({
                        message: currentMessage,
                        contextSummary,
                    }),
                ),
            ]);

            return response.text;
        } catch (error) {
            throw new HttpException('Failed to analyze content', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
