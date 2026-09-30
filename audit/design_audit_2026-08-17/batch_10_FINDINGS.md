**Thread Lens Audit**

---

## LENS: Thread
PURPOSE: View and manage threads in a conversation.

### CURRENT DESIGN:
- Simple list view with thread ID, title, and timestamp
- No clear indication of thread status (e.g., unread, replied to)
- Limited space for thread summary or additional information

### DESIGN DIRECTION:
The thread interface is determined by the conversation domain, displaying only the essential information for each thread, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Thread title with clear indication of unread status
2. **Hero**: Thread summary or brief description
3. **Workspace**: Thread list with clear indication of thread status (e.g., unread, replied to)
4. **Controls**: Thread actions (e.g., reply, delete)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace thread list with card-based layout for better information density
- CURRENT → PROPOSED: Add thread status indicator (e.g., unread, replied to)
- CURRENT → PROPOSED: Introduce thread actions (e.g., reply, delete) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for thread titles and summaries
- Increase spacing between threads for better readability
- Use a subtle border to separate threads

### CAPABILITY PRESENTATION:
- **Thread Status**: Clearly indicate unread and replied-to threads
- **Thread Actions**: Provide clear and prominent thread actions (e.g., reply, delete)

### LENS IDENTITY:
The thread lens is visually distinct with a focus on clear typography and a card-based layout.

### PRIORITY: P1
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 7/10

---

**Tick Lens Audit**

---

## LENS: Tick
PURPOSE: Track progress and completion of tasks.

### CURRENT DESIGN:
- Simple checkbox list with task ID and title
- No clear indication of task priority or due date
- Limited space for task description or additional information

### DESIGN DIRECTION:
The tick interface is determined by the task management domain, displaying essential information for each task, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Task title with clear indication of priority and due date
2. **Hero**: Task description or brief summary
3. **Workspace**: Task list with clear indication of task completion
4. **Controls**: Task actions (e.g., edit, delete)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace checkbox list with card-based layout for better information density
- CURRENT → PROPOSED: Add task priority and due date indicators
- CURRENT → PROPOSED: Introduce task actions (e.g., edit, delete) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for task titles and descriptions
- Increase spacing between tasks for better readability
- Use a subtle border to separate tasks

### CAPABILITY PRESENTATION:
- **Task Status**: Clearly indicate completed and incomplete tasks
- **Task Priority**: Display task priority clearly

### LENS IDENTITY:
The tick lens is visually distinct with a focus on clear typography and a card-based layout.

### PRIORITY: P2
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 6/10

---

**Timeline Lens Audit**

---

## LENS: Timeline
PURPOSE: Visualize and navigate through a timeline of events.

### CURRENT DESIGN:
- Basic timeline with event dates and brief descriptions
- No clear indication of event importance or relevance
- Limited space for event details or additional information

### DESIGN DIRECTION:
The timeline interface is determined by the event domain, displaying essential information for each event, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Event title with clear indication of importance and relevance
2. **Hero**: Event description or brief summary
3. **Workspace**: Timeline with clear indication of event dates and importance
4. **Controls**: Event actions (e.g., edit, delete)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace basic timeline with a more interactive and engaging timeline component
- CURRENT → PROPOSED: Add event importance and relevance indicators
- CURRENT → PROPOSED: Introduce event actions (e.g., edit, delete) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for event titles and descriptions
- Increase spacing between events for better readability
- Use a subtle border to separate events

### CAPABILITY PRESENTATION:
- **Event Importance**: Clearly indicate important and relevant events
- **Event Actions**: Provide clear and prominent event actions (e.g., edit, delete)

### LENS IDENTITY:
The timeline lens is visually distinct with a focus on clear typography and a more interactive timeline component.

### PRIORITY: P2
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 7/10

---

**Tools Lens Audit**

---

## LENS: Tools
PURPOSE: Access and manage various tools and resources.

### CURRENT DESIGN:
- Simple list view with tool names and descriptions
- No clear indication of tool status or availability
- Limited space for tool details or additional information

### DESIGN DIRECTION:
The tools interface is determined by the domain, displaying essential information for each tool, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Tool name with clear indication of status and availability
2. **Hero**: Tool description or brief summary
3. **Workspace**: Tool list with clear indication of tool status and availability
4. **Controls**: Tool actions (e.g., launch, edit)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace simple list view with a more interactive and engaging tool grid
- CURRENT → PROPOSED: Add tool status and availability indicators
- CURRENT → PROPOSED: Introduce tool actions (e.g., launch, edit) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for tool names and descriptions
- Increase spacing between tools for better readability
- Use a subtle border to separate tools

### CAPABILITY PRESENTATION:
- **Tool Status**: Clearly indicate available and unavailable tools
- **Tool Actions**: Provide clear and prominent tool actions (e.g., launch, edit)

### LENS IDENTITY:
The tools lens is visually distinct with a focus on clear typography and a more interactive tool grid.

### PRIORITY: P3
### DESIGN SCORE: 4/10
### UPGRADE POTENTIAL: 5/10

---

**Tournaments Lens Audit**

---

## LENS: Tournaments
PURPOSE: View and manage tournaments and their participants.

### CURRENT DESIGN:
- Basic list view with tournament names and participant information
- No clear indication of tournament status or ranking
- Limited space for tournament details or additional information

### DESIGN DIRECTION:
The tournaments interface is determined by the tournament domain, displaying essential information for each tournament, with a focus on clarity and concision.

### LAYOUT UPGRADE:
1. **Header**: Tournament name with clear indication of status and ranking
2. **Hero**: Tournament description or brief summary
3. **Workspace**: Tournament list with clear indication of tournament status and ranking
4. **Controls**: Tournament actions (e.g., join, edit)

### COMPONENT-LEVEL CHANGES:
- CURRENT → PROPOSED: Replace basic list view with a more interactive and engaging tournament grid
- CURRENT → PROPOSED: Add tournament status and ranking indicators
- CURRENT → PROPOSED: Introduce tournament actions (e.g., join, edit) as a clear call-to-action

### VISUAL UPGRADES:
- Use a clear and concise typography for tournament names and descriptions
- Increase spacing between tournaments for better readability
- Use a subtle border to separate tournaments

### CAPABILITY PRESENTATION:
- **Tournament Status**: Clearly indicate active and completed tournaments
- **Tournament Actions**: Provide clear and prominent tournament actions (e.g., join, edit)

### LENS IDENTITY:
The tournaments lens is visually distinct with a focus on clear typography and a more interactive tournament grid.

### PRIORITY: P3
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 6/10

---

---

## 16. Voice
### LENS: voice
### PURPOSE: Allow users to manage and customize the voice assistant.


### CURRENT DESIGN:
- The voice assistant's settings are buried under a dropdown menu
- The voice assistant's customization options are limited to a basic toggle for enable/disable
- The voice assistant's configuration is not visually distinct from other settings

### DESIGN DIRECTION:
The domain determines the interface by requiring users to navigate through a series of voice-centric screens to manage voice settings and customization.

### LAYOUT UPGRADE:
1. **Voice Settings**: Prominent header for voice settings
2. **Voice Assistant Toggle**: Prominent toggle to enable/disable voice assistant
3. **Customization Options**: Secondary section for advanced voice settings, such as voice type and language
4. **Configuration**: Footer section for voice configuration, such as voice data and history

### COMPONENT-LEVEL CHANGES:
- **Voice Settings Button** → **Voice Settings Header** (more prominent and distinct)
- **Voice Assistant Toggle** → **Voice Assistant Switch** (more intuitive and user-friendly)
- **Customization Options** → **Voice Customization Card** (more visually appealing and interactive)

### VISUAL UPGRADES:
- **Typography**: Use a clear, readable font for voice settings and customization options
- **Spacing**: Increase spacing between voice settings and customization options
- **Sizing**: Make the voice assistant toggle and customization options more prominent

### CAPABILITY PRESENTATION:
- **Manage Voice Settings**: Users can customize and manage voice settings in a dedicated section
- **Customize Voice Assistant**: Users can personalize voice assistant settings, such as voice type and language

### LENS IDENTITY:
The voice lens is visually distinct with a distinct design language that emphasizes voice-centric features.

### PRIORITY: P1
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 8/10

---

## 17. Vote
### LENS: vote
### PURPOSE: Allow users to cast votes and participate in polls.


### CURRENT DESIGN:
- The vote lens is cluttered with too many features and options
- The vote lens feels generic and lacks a clear identity
- The vote lens has a confusing navigation menu

### DESIGN DIRECTION:
The domain determines the interface by requiring users to interact with a dedicated vote screen that focuses on casting votes and participating in polls.

### LAYOUT UPGRADE:
1. **Vote Header**: Prominent header for the vote lens
2. **Polls**: Primary section for displaying available polls
3. **Vote Options**: Secondary section for casting votes and selecting options
4. **Results**: Footer section for displaying vote results

### COMPONENT-LEVEL CHANGES:
- **Vote Button** → **Cast Vote Button** (more prominent and distinct)
- **Poll List** → **Poll Card** (more visually appealing and interactive)
- **Vote Options** → **Vote Form** (more user-friendly and intuitive)

### VISUAL UPGRADES:
- **Typography**: Use a bold, attention-grabbing font for vote headers and options
- **Spacing**: Reduce spacing between vote options and poll cards
- **Sizing**: Make the cast vote button and poll cards more prominent

### CAPABILITY PRESENTATION:
- **Cast Votes**: Users can easily cast votes on available polls
- **Participate in Polls**: Users can interact with polls and select options

### LENS IDENTITY:
The vote lens is visually distinct with a bold and attention-grabbing design language that emphasizes voting and polling features.

### PRIORITY: P2
### DESIGN SCORE: 7/10
### UPGRADE POTENTIAL: 7/10

---

## 18. Wallet
### LENS: wallet
### PURPOSE: Allow users to manage their digital wallet.


### CURRENT DESIGN:
- The wallet lens is cluttered with too many features and options
- The wallet lens feels generic and lacks a clear identity
- The wallet lens has a confusing navigation menu

### DESIGN DIRECTION:
The domain determines the interface by requiring users to interact with a dedicated wallet screen that focuses on managing digital wallet features.

### LAYOUT UPGRADE:
1. **Wallet Header**: Prominent header for the wallet lens
2. **Account Information**: Primary section for displaying account details
3. **Transactions**: Secondary section for displaying transactions and activity
4. **Settings**: Footer section for wallet settings and options

### COMPONENT-LEVEL CHANGES:
- **Wallet Button** → **Wallet Header** (more prominent and distinct)
- **Account Info** → **Account Card** (more visually appealing and interactive)
- **Transactions** → **Transaction List** (more user-friendly and intuitive)

### VISUAL UPGRADES:
- **Typography**: Use a clean, modern font for wallet headers and account information
- **Spacing**: Reduce spacing between wallet sections and transactions
- **Sizing**: Make the wallet header and account card more prominent

### CAPABILITY PRESENTATION:
- **Manage Wallet**: Users can easily manage their digital wallet and account details
- **Track Transactions**: Users can view and interact with transaction history

### LENS IDENTITY:
The wallet lens is visually distinct with a clean and modern design language that emphasizes wallet management features.

### PRIORITY: P3
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 6/10

---

## 19. Welding
### LENS: welding
### PURPOSE: Provide users with a comprehensive welding guide and resources.


### CURRENT DESIGN:
- The welding lens is cluttered with too many features and options
- The welding lens feels generic and lacks a clear identity
- The welding lens has a confusing navigation menu

### DESIGN DIRECTION:
The domain determines the interface by requiring users to interact with a dedicated welding screen that focuses on providing comprehensive welding resources and guides.

### LAYOUT UPGRADE:
1. **Welding Header**: Prominent header for the welding lens
2. **Guides**: Primary section for displaying welding guides and tutorials
3. **Resources**: Secondary section for displaying welding resources and tools
4. **Community**: Footer section for welding community forums and discussions

### COMPONENT-LEVEL CHANGES:
- **Welding Button** → **Welding Header** (more prominent and distinct)
- **Guide List** → **Guide Card** (more visually appealing and interactive)
- **Resource List** → **Resource Card** (more user-friendly and intuitive)

### VISUAL UPGRADES:
- **Typography**: Use a bold, industrial font for welding headers and guides
- **Spacing**: Reduce spacing between welding sections and guides
- **Sizing**: Make the welding header and guide cards more prominent

### CAPABILITY PRESENTATION:
- **Welding Guides**: Users can access and interact with comprehensive welding guides and tutorials
- **Welding Resources**: Users can access and interact with welding resources and tools

### LENS IDENTITY:
The welding lens is visually distinct with a bold and industrial design language that emphasizes welding features and resources.

### PRIORITY: P1
### DESIGN SCORE: 8/10
### UPGRADE POTENTIAL: 9/10

---

## 20. Wellness
### LENS: wellness
### PURPOSE: Provide users with a personalized wellness plan and resources.


### CURRENT DESIGN:
- The wellness lens is cluttered with too many features and options
- The wellness lens feels generic and lacks a clear identity
- The wellness lens has a confusing navigation menu

### DESIGN DIRECTION:
The domain determines the interface by requiring users to interact with a dedicated wellness screen that focuses on providing personalized wellness plans and resources.

### LAYOUT UPGRADE:
1. **Wellness Header**: Prominent header for the wellness lens
2. **Personalized Plan**: Primary section for displaying personalized wellness plans
3. **Resources**: Secondary section for displaying wellness resources and tools
4. **Tracking**: Footer section for tracking progress and activity

### COMPONENT-LEVEL CHANGES:
- **Wellness Button** → **Wellness Header** (more prominent and distinct)
- **Plan List** → **Plan Card** (more visually appealing and interactive)
- **Resource List** → **Resource Card** (more user-friendly and intuitive)

### VISUAL UPGRADES:
- **Typography**: Use a clean, modern font for wellness headers and plans
- **Spacing**: Reduce spacing between wellness sections and resources
- **Sizing**: Make the wellness header and plan cards more prominent

### CAPABILITY PRESENTATION:
- **Personalized Wellness**: Users can access and interact with a personalized wellness plan
- **Wellness Resources**: Users can access and interact with wellness resources and tools

### LENS IDENTITY:
The wellness lens is visually distinct with a clean and modern design language that emphasizes wellness features and resources.

### PRIORITY: P2
### DESIGN SCORE: 7/10
### UPGRADE POTENTIAL: 8/10

---

**Whiteboard Lens**
================

### LENS: Whiteboard
### PURPOSE: Collaborative brainstorming and idea generation

### CURRENT DESIGN:
- Simple, minimalistic layout that works well for basic note-taking
- Lack of clear separation between different sections
- Insufficient feedback for users when adding new ideas or notes

### DESIGN DIRECTION:
The whiteboard lens should prioritize flexibility and adaptability, allowing users to freely arrange and reorganize their ideas. The domain of collaborative brainstorming dictates a focus on simplicity and ease of use.

### LAYOUT UPGRADE:
1. **Reorganize sections**: Introduce a clear hierarchy of sections (e.g., ideas, notes, to-do's) with visually distinct headers and separators.
2. **Enhance whitespace**: Increase whitespace between elements to improve readability and reduce visual noise.
3. **Introduce drag-and-drop functionality**: Enable users to easily reposition and resize elements on the board.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: Note-taking field → Interactive, resizable sticky note
- `CURRENT → PROPOSED`: Idea categorization → Auto-suggesting, collapsible categories
- `CURRENT → PROPOSED`: Undo/redo functionality → Real-time revision history

### VISUAL UPGRADES:
• **Typography**: Use a clean, sans-serif font (e.g., Open Sans) for better readability.
• **Spacing**: Increase line height and padding between elements for a more spacious feel.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time collaboration**: Users can see others' changes in real-time and engage in simultaneous brainstorming.
- **Flexible organization**: Users can easily reorganize and categorize their ideas and notes.

### LENS IDENTITY:
The whiteboard lens is visually distinct through its use of a bright, neutral color scheme and clean typography.

### PRIORITY: P1
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 8/10

---

**World Lens**
=============

### LENS: World
### PURPOSE: Exploring and understanding the world's information

### CURRENT DESIGN:
- Dated, cluttered interface with too many features and options
- Insufficient visual hierarchy and poor use of whitespace
- Lack of clear calls-to-action and navigation

### DESIGN DIRECTION:
The world lens should prioritize clarity and concision, presenting users with a clear and focused view of the world's information. The domain of global exploration dictates a focus on maps, data visualization, and clear navigation.

### LAYOUT UPGRADE:
1. **Streamline features**: Prioritize essential features and eliminate clutter.
2. **Improve visual hierarchy**: Use clear typography and consistent spacing to guide the user's attention.
3. **Enhance navigation**: Introduce clear calls-to-action and a more intuitive navigation system.
4. **Introduce data visualization**: Use charts, graphs, and maps to present complex data in an easily digestible format.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: Global map → Interactive, zoomable map with real-time updates
- `CURRENT → PROPOSED`: Information panels → Customizable, collapsible info cards
- `CURRENT → PROPOSED`: Search bar → Autocomplete, real-time suggestions

### VISUAL UPGRADES:
• **Typography**: Use a clear, readable font (e.g., Lato) for body text and a sans-serif font for headings.
• **Spacing**: Increase whitespace between elements to improve readability.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time updates**: Users see the latest information and updates from around the world.
- **Customizable views**: Users can tailor the lens to their interests and needs.

### LENS IDENTITY:
The world lens is visually distinct through its use of a bold, earth-toned color scheme and clear typography.

### PRIORITY: P2
### DESIGN SCORE: 7/10
### UPGRADE POTENTIAL: 9/10

---

**World Creator Lens**
=====================

### LENS: World Creator
### PURPOSE: Creating and sharing custom worlds

### CURRENT DESIGN:
- Confusing, cluttered interface with too many options and settings
- Insufficient feedback for users when creating and customizing worlds
- Lack of clear guidance and tutorials

### DESIGN DIRECTION:
The world creator lens should prioritize creativity and flexibility, providing users with a clear and intuitive interface for building and customizing their worlds. The domain of world creation dictates a focus on creative freedom and clear feedback.

### LAYOUT UPGRADE:
1. **Simplify options**: Streamline settings and options to reduce overwhelm.
2. **Improve feedback**: Provide clear, visual feedback for users when creating and customizing worlds.
3. **Introduce tutorials**: Offer step-by-step guides and interactive tutorials to help users get started.
4. **Enhance collaboration**: Allow multiple users to collaborate on world creation in real-time.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: World creation interface → Interactive, 3D world builder
- `CURRENT → PROPOSED`: Settings panel → Customizable, collapsible settings cards
- `CURRENT → PROPOSED`: Feedback system → Real-time, visual feedback for actions

### VISUAL UPGRADES:
• **Typography**: Use a creative, hand-drawn font (e.g., Pacifico) for headings and a clean sans-serif font for body text.
• **Spacing**: Increase whitespace between elements to improve readability.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time collaboration**: Users can collaborate with others in real-time to create and customize worlds.
- **Customization options**: Users have complete control over world creation and customization.

### LENS IDENTITY:
The world creator lens is visually distinct through its use of a bright, vibrant color scheme and creative typography.

### PRIORITY: P1
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 8/10

---

**World Observatory Lens**
==========================

### LENS: World Observatory
### PURPOSE: Analyzing and understanding global trends and patterns

### CURRENT DESIGN:
- Overwhelming, cluttered interface with too much data and analysis
- Insufficient visual hierarchy and poor use of whitespace
- Lack of clear calls-to-action and navigation

### DESIGN DIRECTION:
The world observatory lens should prioritize clarity and concision, presenting users with a clear and focused view of global trends and patterns. The domain of data analysis dictates a focus on clear data visualization and intuitive navigation.

### LAYOUT UPGRADE:
1. **Streamline data**: Prioritize essential data and eliminate clutter.
2. **Improve visual hierarchy**: Use clear typography and consistent spacing to guide the user's attention.
3. **Enhance navigation**: Introduce clear calls-to-action and a more intuitive navigation system.
4. **Introduce data visualization**: Use charts, graphs, and maps to present complex data in an easily digestible format.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: Data tables → Interactive, filterable data visualizations
- `CURRENT → PROPOSED`: Analysis tools → Customizable, collapsible analysis cards
- `CURRENT → PROPOSED`: Navigation menu → Clear, concise menu with real-time updates

### VISUAL UPGRADES:
• **Typography**: Use a clear, readable font (e.g., Lato) for body text and a sans-serif font for headings.
• **Spacing**: Increase whitespace between elements to improve readability.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time analysis**: Users see the latest trends and patterns in real-time.
- **Customizable views**: Users can tailor the lens to their interests and needs.

### LENS IDENTITY:
The world observatory lens is visually distinct through its use of a neutral, earth-toned color scheme and clear typography.

### PRIORITY: P2
### DESIGN SCORE: 6/10
### UPGRADE POTENTIAL: 8/10

---

**World Model Lens**
====================

### LENS: World Model
### PURPOSE: Understanding and visualizing global systems and relationships

### CURRENT DESIGN:
- Confusing, cluttered interface with too many options and settings
- Insufficient feedback for users when creating and customizing world models
- Lack of clear guidance and tutorials

### DESIGN DIRECTION:
The world model lens should prioritize clarity and flexibility, providing users with a clear and intuitive interface for building and customizing their world models. The domain of systems thinking dictates a focus on visualizing relationships and complex systems.

### LAYOUT UPGRADE:
1. **Simplify options**: Streamline settings and options to reduce overwhelm.
2. **Improve feedback**: Provide clear, visual feedback for users when creating and customizing world models.
3. **Introduce tutorials**: Offer step-by-step guides and interactive tutorials to help users get started.
4. **Enhance collaboration**: Allow multiple users to collaborate on world model creation in real-time.

### COMPONENT-LEVEL CHANGES:
- `CURRENT → PROPOSED`: World model builder → Interactive, 3D world model builder
- `CURRENT → PROPOSED`: Settings panel → Customizable, collapsible settings cards
- `CURRENT → PROPOSED`: Feedback system → Real-time, visual feedback for actions

### VISUAL UPGRADES:
• **Typography**: Use a creative, hand-drawn font (e.g., Pacifico) for headings and a clean sans-serif font for body text.
• **Spacing**: Increase whitespace between elements to improve readability.
• **Sizing**: Use a consistent size for all elements to maintain visual balance.

### CAPABILITY PRESENTATION:
- **Real-time collaboration**: Users can collaborate with others in real-time to create and customize world models.
- **Customization options**: Users have complete control over world model creation and customization.

### LENS IDENTITY:
The world model lens is visually distinct through its use of a bright, vibrant color scheme and creative typography.

### PRIORITY: P1
### DESIGN SCORE: 5/10
### UPGRADE POTENTIAL: 8/10