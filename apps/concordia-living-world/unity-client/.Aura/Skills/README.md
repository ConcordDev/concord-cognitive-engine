# Aura Skills

Drop Claude Code-compatible skills in this folder, one directory per skill:

    Skills/
      my-skill/
        SKILL.md     # YAML frontmatter + markdown body

Frontmatter fields Aura uses:
  description              what the skill does + when to use it (drives
                           autonomous invocation by the model)
  when-to-use              extra trigger text appended after the description
  argument-hint            autocomplete hint shown in the / menu
  disable-model-invocation true = only runs when you type /my-skill
  user-invocable           false = hidden from the / menu

The directory name is the command name (/my-skill). The markdown body is
injected into the conversation when the skill is invoked; trailing text after
the command is appended under an "Arguments:" line. Skills are plain text -
Aura does not run scripts, shell commands, or load sibling files.

To share skills with your team through version control, make sure your ignore
file does not exclude this folder. If you ignore .Aura/, add a negation:

    # .gitignore
    .Aura/
    !.Aura/Skills/
