export interface HelpQuestion {
    id: string;
    question: string;
    answer: string;
    keywords: string;
}

export interface HelpSection {
    id: string;
    title: string;
    description: string;
    questions: HelpQuestion[];
}

const faq = (number: number, question: string, answer: string, keywords = ''): HelpQuestion => ({
    id: `help-question-${number}`,
    question,
    answer,
    keywords,
});

export const HELP_SECTIONS: HelpSection[] = [
    {
        id: 'editor',
        title: 'Editor & character mentions',
        description: 'Name suggestions, highlighting, layout and writing statistics.',
        questions: [
            faq(1, 'How do I quickly insert a character name?',
                'Type @ in the manuscript to open character suggestions. Keep typing the start of a name to narrow the list. Create and save the character in Character Settings first.', 'mention tag'),
            faq(2, 'Why does @ not open suggestions after Chinese text?',
                'The @ symbol must be at the start of a paragraph or follow a space. After Chinese text, type a normal space before @. When you choose a character, StoryArk handles that trigger space for you.', 'Chinese input space mention'),
            faq(3, 'Can I choose a character with the keyboard?',
                'Yes. Use the Up and Down arrow keys to move through suggestions, Enter to insert a name, and Esc to close the list. Up to five suggestions are shown at a time.'),
            faq(4, 'Why do character names change color as I type?',
                'StoryArk recognizes saved character names and aliases and highlights them in the character’s theme color. Each character can have up to three aliases for automatic highlighting.'),
            faq(5, 'Can I search aliases in the @ suggestions?',
                'The @ list currently matches the start of the character’s main name. Aliases are mainly used to recognize other names for that character in the manuscript.'),
            faq(6, 'How do I remove an incorrect character highlight?',
                'Right-click the highlighted name and choose Unmark. That occurrence becomes ordinary text, and StoryArk avoids highlighting it again immediately.'),
            faq(7, 'Does Unmark turn off all highlights for that character?',
                'No. It affects only that occurrence. To reduce automatic highlighting for a character role, open Writing Preferences → Character Tag Auto-highlight and turn off that role.'),
            faq(8, 'Does removing a highlight stop AI from using that character?',
                'Not necessarily. Unmark changes the text’s marking and appearance. StoryArk may still recognize the character by a name appearing in the manuscript.'),
            faq(9, 'How can I check character details while writing?',
                'Hover over a highlighted name to see its character card. While editing, hold Ctrl on Windows or Command on macOS and click the name to open Character Settings. In a locked manuscript, you can click the name directly.'),
            faq(10, 'Does archiving a character remove their name from the story?',
                'No. Existing text, mentions and relationship map links stay in place. The archived character stops appearing in new suggestions and automatic highlighting.'),
            faq(11, 'How do I indent a paragraph, and why does pasted text change font?',
                'Press Tab to insert two full-width spaces for a Chinese paragraph indent. Pasted text adopts the font and size at the cursor so it fits the surrounding manuscript.', 'paste formatting typography'),
            faq(12, 'Can I resize the editor sidebars?',
                'Drag the divider between a sidebar and the writing area. Double-click the divider to reset its width. The available range changes with the window size to leave room for writing.'),
            faq(13, 'What if some toolbar buttons are out of view?',
                'When the window is narrow or a sidebar is wide, the top toolbar stays on one line. Scroll it horizontally to reach the remaining buttons.'),
            faq(14, 'What is the difference between Words and Characters?',
                'Words uses a mixed Chinese and English writing count: Han characters and some Chinese punctuation count individually, while English words count as words. Characters counts visible characters, including punctuation, but not spaces or line breaks. Neither includes the chapter title. For example, 你好 hello counts as 3 Words and 7 Characters.'),
            faq(15, 'Does Typing measure keyboard presses?',
                'No. It estimates visible characters typed per minute. Chinese input counts when you confirm the text. Paste, AI insertion and deletion do not increase the rate. It returns to zero about 1.5 seconds after you stop typing.', 'speed chars/min'),
        ],
    },
    {
        id: 'search',
        title: 'Title & story search',
        description: 'Find chapters and passages, and understand search results.',
        questions: [
            faq(16, 'How do Title / Chapter and Semantic / Story differ?',
                'Title / Chapter finds chapter or volume names. Semantic / Story searches manuscript passages and other story material. You can use keywords or describe what you want to find.'),
            faq(17, 'Are semantic search results always accurate?',
                'No. Search looks for related meaning, so a result may not contain your exact words. It can also miss relevant passages or return unrelated ones. Use it to help recall and locate material, then check the source text.', 'embedding accuracy'),
            faq(18, 'Why are some search results not highlighted?',
                'Related meaning does not always correspond to an exact word in the text. Only results found through keyword matching attempt a text highlight. A result found by meaning alone can open the related passage without highlighting a specific word.', 'lexical semantic'),
            faq(19, 'Does Semantic / Story only search the manuscript?',
                'No. It can also search chapter summaries, character profiles, relationships, foreshadowing notes and some settings. Open Search filters to choose the sources, chapter range or update dates.'),
            faq(20, 'Does Include planning material search every future plot plan?',
                'Currently, this option mainly adds the saved story outline and background. It does not mean that every plan for events that have not happened will be included.'),
            faq(21, 'Why can’t I find text I just wrote?',
                'Search material needs to be updated after saving, so new text may take a little time to appear. Use Prepare search or Refresh search to update it manually. With automatic updates enabled, StoryArk also handles this in the background.', 'index rebuild'),
            faq(22, 'Can I keep writing while search updates?',
                'Yes. Updates run in the background. Automatic updates normally start after saved changes settle for about a minute, or after five minutes of continuous changes.', 'index schedule'),
            faq(23, 'Why can some results locate a passage, while others only open a chapter or summary?',
                'Manuscript results can usually locate the related passage. A chapter summary result opens its summary. Other reference material may not correspond to one sentence in the manuscript, so precise location and highlighting are not always available.'),
            faq(24, 'Why can’t an old search result locate its passage anymore?',
                'The passage may have changed or been deleted since the search. Refresh search and try again rather than relying on the old result.'),
            faq(25, 'Does semantic search need an AI model configuration or internet connection?',
                'Story search uses the local model bundled with StoryArk, so it can run on your device without the API key used for AI writing. AI Continue and AI Brainstorm use a separately configured generation service.', 'embedding offline local'),
        ],
    },
    {
        id: 'continue',
        title: 'AI Continue',
        description: 'Choose an insertion point, review references and adopt a continuation.',
        questions: [
            faq(26, 'What does AI Continue use as context?',
                'It first reads recent manuscript text before the cursor or the start of your selection. It then looks for related material in this work, such as earlier passages, chapter summaries, characters, relationships, story background and foreshadowing notes. It does not send the whole book by default.'),
            faq(27, 'Does the cursor position affect the continuation?',
                'Yes. Put the cursor at the end to continue the chapter, or in the middle to continue from that point. The text before that position guides generation. If text is selected, adopting the result replaces the selection. Clear the selection first if you only want to insert text.'),
            faq(28, 'Can AI Continue use text that has not been autosaved yet?',
                'Yes. It uses the current editor draft, not just the last saved text. Check the save indicator to confirm that your work has been saved.'),
            faq(29, 'Could AI Continue reveal later events too early?',
                'Reference material is restricted by the continuation position, excluding later manuscript chapters and future plot plans. Character profiles, background or outlines can still contain later information, and AI may make its own guesses. Review the result for unwanted spoilers.'),
            faq(30, 'How can I make continuations fit my story better?',
                'Place the cursor at the intended continuation point and provide enough preceding text. Keep character details, background and chapter summaries up to date. If a result drifts, review the reference material it used before regenerating.'),
            faq(31, 'Can I exclude a reference from AI generation?',
                'Yes. Uncheck it in the result’s reference list, then regenerate. The change affects the next generation; it does not rewrite the result already shown.'),
            faq(32, 'Does generation change my manuscript immediately?',
                'No. AI text appears as a candidate first. Choose Adopt to insert it, or regenerate or discard it instead.'),
            faq(33, 'Why is Adopt unavailable after generation?',
                'The draft, insertion position or reference material may have changed, or the chapter may now be locked. The candidate stays available for review. Follow the message to regenerate or explicitly choose the current insertion point.'),
            faq(34, 'Will Stop or a generation failure damage my draft?',
                'Stopping or failing a generation does not rewrite your original draft. Text already received may remain available to read, but an incomplete result cannot be adopted as a normally completed candidate.'),
            faq(35, 'How do I control continuation length?',
                'Open Writing Preferences → AI Continue to adjust the recent context length and approximate output length. The output length is a target, not a guarantee that the model will return exactly that many characters.'),
        ],
    },
    {
        id: 'brainstorm',
        title: 'Brainstorm & chapter summaries',
        description: 'Prepare useful context and review ideas before saving them.',
        questions: [
            faq(36, 'What does AI Brainstorm use as context?',
                'It uses the story outline, story background, selected chapter summaries, profiles of characters recognized in those chapters, and relationships between those characters. Existing plot plans are also supplied as possible future directions.'),
            faq(37, 'Why select chapters? Is selecting more always better?',
                'The selected chapters set the focus of the brainstorm. Choose those relevant to the next plot direction rather than automatically selecting everything. Long reference material is bounded, so not all of it will necessarily reach the model.'),
            faq(38, 'Can I brainstorm without chapter summaries?',
                'Yes. For a chapter without a current summary, StoryArk uses a short passage from its end and may add related retrieved passages. It does not substitute the entire chapter. A good summary helps the model understand the chapter as a whole.'),
            faq(39, 'Why is a character missing from Appearing Characters?',
                'StoryArk identifies characters through mentions and recognized names or aliases in the selected chapters. Missing profiles, unregistered names, or disabled automatic highlighting for a role can affect recognition.'),
            faq(40, 'Will AI treat my plot plans as events that already happened?',
                'The model is told that plot plans are possible future directions, not established events. Review the result anyway, especially for confusion between plans and the manuscript.'),
            faq(41, 'Does Choose Direction save the result or add it to the manuscript?',
                'It does not add text to the manuscript. The chosen direction becomes an editable brainstorm result. Make your changes, then choose Save Result. Show All Options lets you return to the other directions.'),
            faq(42, 'Can I use the brainstorm page without AI?',
                'Yes. You can write and save the editable result by hand and review previously saved directions. AI is one way to get candidate ideas, not a requirement for the workspace.'),
            faq(43, 'Does an AI chapter summary use the whole book?',
                'The selected chapter’s manuscript is the main source. Related character profiles and confirmed settings can clarify names and terms, but are not evidence that an event happened in this chapter. A generated suggestion replaces the current summary only after you accept it.'),
            faq(44, 'Why does a chapter summary need review?',
                'The manuscript, character mentions or related material may have changed, so the old summary might no longer match. Review it and keep it if it is still accurate, or edit it or generate a new suggestion.'),
        ],
    },
    {
        id: 'foreshadowing',
        title: 'Foreshadowing & relationships',
        description: 'Link planted clues to the manuscript and build a character map.',
        questions: [
            faq(45, 'How do I add foreshadowing to the manuscript?',
                'Select a passage, right-click it and choose Add Foreshadowing. StoryArk underlines the passage and creates a linked record. Click the mark to view its foreshadowing, or add notes from the Foreshadowing Board.'),
            faq(46, 'What does Mark Recovered mean?',
                'It marks a planted clue as paid off in the story. It only changes the record’s status; it does not write the payoff or remove the source text. Choose Undo Recovered if you marked it by mistake.'),
            faq(47, 'How do I return to a foreshadowing passage? What if it was deleted?',
                'Choose Open Chapter on the card to open its chapter and try to locate the passage. If the original text or its link has been removed, the record can remain but its source may no longer be located.'),
            faq(48, 'How do I add characters and edit relationships on the map?',
                'Drag a character from the left panel onto the canvas, then connect nodes using their connection points. Click a relationship line to edit its label or delete it. Right-click a node to change the purpose of its connection points.'),
            faq(49, 'Can the same character appear more than once on the relationship map?',
                'Yes. Drag the same character onto the canvas again to arrange different relationship groups. The nodes still refer to the same character profile. Removing a canvas node does not delete the character profile.'),
        ],
    },
    {
        id: 'saving',
        title: 'Saving, models & moving your work',
        description: 'Save safely, configure AI and transfer a work to another device.',
        questions: [
            faq(50, 'What saves automatically, and when should I use a Save button?',
                'The manuscript normally autosaves about a second after you stop editing. Character profiles, story planning, the relationship map and brainstorm results have their own save controls. Watch the save indicator. After a save failure, your changes may only be in the current page, so retry before leaving.'),
            faq(51, 'Why can’t I edit the manuscript or use an AI action?',
                'Check whether the chapter is locked. A lock on its volume or the whole work can also restrict actions. Unlock the relevant item when you want to edit again.'),
            faq(52, 'I added a model configuration. Why is AI still unavailable?',
                'Save the configuration and set the one you want to use as Default. Test connection can check whether it works. Saving a configuration does not automatically test it.'),
            faq(53, 'Does Test connection send my manuscript?',
                'No. It sends a short test message instead of your manuscript. The model service may still charge a small amount for the test.'),
            faq(54, 'Why does AI take so long? How should I set timeout and output limits?',
                'Waiting time depends on the model, connection and requested output. New configurations allow five minutes per request; existing configurations can be adjusted. The provider output cap limits generated tokens, not input capacity or manuscript character count. Leave it blank when the service supports a default, or choose a value supported by the model when an explicit cap is required.', 'request timeout tokens advanced limits'),
            faq(55, 'What information is sent when I use AI?',
                'If you configure an online model service, the manuscript excerpts and reference material needed for that generation are sent to that service. Ordinary local writing and local semantic search do not need to send manuscript text to the generation service.', 'privacy API'),
            faq(56, 'How do Word, PDF and StoryArk work exports differ?',
                'Word and PDF mainly export the current chapter for reading, printing or sharing. StoryArk work (.storyark.json) transfers a work, including chapters, characters, planning, the relationship map, foreshadowing and saved brainstorm material.'),
            faq(57, 'Will my model settings and search data move to another computer too?',
                'A work export excludes AI model settings, API keys, app preferences, unsaved AI candidates and files linked from your computer. Set those up again on the new device. Story search data can be prepared there again.'),
            faq(58, 'Will importing overwrite my work or merge changes?',
                'When the work already exists, you can create a copy or replace the existing work. Replace is not an automatic merge and will not combine edits passage by passage. Choose Create copy if you want to keep both versions.'),
            faq(59, 'Does StoryArk automatically sync between computers?',
                'Not currently. Works are saved on this device. Use StoryArk work export and import to move a work between computers.'),
            faq(60, 'How do I provide useful information when reporting an error?',
                'Describe what you did before the error and include the message you saw. Find the Error log path in Settings and attach that file when asking for help. The log does not necessarily include the manuscript or every action, so steps to reproduce the problem are still useful.'),
        ],
    },
];

export const HELP_QUESTION_COUNT = HELP_SECTIONS.reduce((count, section) => count + section.questions.length, 0);

/** Search every section, including answer text and common alternative terms. */
export function searchHelp(query: string): HelpSection[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return HELP_SECTIONS;
    return HELP_SECTIONS.map(section => ({
        ...section,
        questions: section.questions.filter(item => {
            const text = `${section.title} ${item.question} ${item.answer} ${item.keywords}`.toLocaleLowerCase();
            return terms.every(term => text.includes(term));
        }),
    })).filter(section => section.questions.length > 0);
}
