import { useLayoutEffect, useRef } from 'react';
import { ACTS } from '../common/acts';
import { LOOK_CHAT } from '../common/lookSample';
import { PLACES } from '../common/places';
import { MESSAGE_FIELD } from '../common/words';
import { Avatar, Button, ChatFrame, ChatRow, ChatTitle, Composer, FaceButton, IconButton, Rail, SendButton, Sidebar, Story, StoryMessage, useWide, type Reading } from '../ui';

const { character, faces, chats, rows } = LOOK_CHAT;
const nothing = () => {};

// The frame's own parts with a made-up chat in them, for a theme's card: whatever draws the app draws its picture,
// the rail and the list only where the app has them beside a chat.
export function ThemeSample({ reading }: { reading: Reading }) {
  const wide = useWide();
  const input = useRef<HTMLTextAreaElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  // A chat is read at its end, which moves as the frame measures its composer and the fonts load.
  useLayoutEffect(() => {
    const story = scroll.current!;
    const follow = () => {
      story.scrollTop = story.scrollHeight;
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(story.firstElementChild!);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      {wide && (
        <>
          <Rail
            actions={
              <>
                <IconButton {...PLACES.gallery} framed onClick={nothing} />
                <IconButton {...PLACES.search} framed onClick={nothing} />
                <IconButton {...ACTS.create} framed onClick={nothing} />
              </>
            }
            places={
              <>
                <IconButton {...PLACES.board} framed onClick={nothing} />
                <IconButton {...PLACES.tools} framed onClick={nothing} />
                <IconButton {...PLACES.settings} framed onClick={nothing} />
              </>
            }
          >
            {faces.map((face, index) => (
              <FaceButton key={face} label={face} current={index === 0} onClick={nothing}>
                <Avatar size="rail" face={face} />
              </FaceButton>
            ))}
          </Rail>
          <Sidebar
            actions={
              <Button variant="secondary" size="sm" icon={ACTS.newChat.icon} onClick={nothing}>
                {ACTS.newChat.label}
              </Button>
            }
          >
            {chats.map((title, index) => (
              <ChatRow key={title} title={title} time="" typing={false} preview={character} sought={false} face={<Avatar face={character} />} current={index === 0} onClick={nothing} />
            ))}
          </Sidebar>
        </>
      )}
      <ChatFrame
        title={<ChatTitle name={character} description={chats[0]} face={<Avatar size="sm" face={character} />} />}
        actions={null}
        above={null}
        footer={<Composer value="" onChange={nothing} onKeyDown={nothing} placeholder={MESSAGE_FIELD} tools={null} more={null} actions={<SendButton streaming={false} disabled={false} title="" onClick={nothing} />} inputRef={input} compact={false} onOpen={nothing} />}
        dockRef={dock}
        scrollRef={scroll}
        onScroll={nothing}
        reading={reading}
        hideHeader={false}
        stage={false}
        side="right"
        compact={false}
      >
        {rows.map(({ name, mine, html }, index) => (
          <StoryMessage key={index} avatar={<Avatar size="story" face={name} tone={mine ? 'you' : 'plain'} />} name={name} time="" mine={mine} id={String(index)}>
            <Story html={html} />
          </StoryMessage>
        ))}
      </ChatFrame>
    </>
  );
}
