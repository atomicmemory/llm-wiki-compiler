/**
 * Anthropic LLM provider implementation.
 *
 * Wraps the @anthropic-ai/sdk to implement the LLMProvider interface.
 * Handles complete, streaming, and tool-use calls against Claude models.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMMessage, LLMTool } from "../utils/provider.js";

/** Anthropic-backed LLM provider using the official SDK. */
export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(model: string) {
    this.model = model;
    this.client = new Anthropic();
  }

  /** Send a single non-streaming completion request. */
  async complete(system: string, messages: LLMMessage[], maxTokens: number): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages,
    });

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock?.type === "text" ? textBlock.text : "";
  }

  /** Stream a completion, invoking onToken for each text chunk. */
  async stream(
    system: string,
    messages: LLMMessage[],
    maxTokens: number,
    onToken?: (text: string) => void,
  ): Promise<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages,
    });

    let fullText = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullText += event.delta.text;
        onToken?.(event.delta.text);
      }
    }

    return fullText;
  }

  /** Call Claude with tool definitions and return the parsed tool input as JSON. */
  async toolCall(
    system: string,
    messages: LLMMessage[],
    tools: LLMTool[],
    maxTokens: number,
  ): Promise<string> {
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages,
      tools: anthropicTools,
    });

    const toolBlock = response.content.find((block) => block.type === "tool_use");
    if (toolBlock?.type === "tool_use") {
      return JSON.stringify(toolBlock.input);
    }

    const textBlock = response.content.find((block) => block.type === "text");
    return textBlock?.type === "text" ? textBlock.text : "";
  }
}
