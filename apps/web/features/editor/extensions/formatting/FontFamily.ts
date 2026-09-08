import { Extension, type CommandProps } from '@tiptap/core';

export const CustomFontFamily = Extension.create({
    name: 'fontFamily',
    addOptions() {
        return { types: ['textStyle'] };
    },
    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    fontFamily: {
                        default: null,
                        parseHTML: element => element.style.fontFamily || null,
                        renderHTML: attributes => {
                            if (!attributes.fontFamily) return {};
                            return { style: `font-family: ${attributes.fontFamily}` };
                        },
                    },
                },
            },
        ];
    },
    addCommands() {
        return {
            setFontFamily: (fontFamily: string) => ({ chain }: CommandProps) => {
                return chain().setMark('textStyle', { fontFamily }).run();
            },
            unsetFontFamily: () => ({ chain }: CommandProps) => {
                return chain().setMark('textStyle', { fontFamily: null }).run();
            },
        };
    },
});
