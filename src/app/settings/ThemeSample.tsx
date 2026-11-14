import { MessagesSquare, Search, Settings } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { storyHtml } from '../../engine/display';
import { ACTS } from '../common/acts';
import { BOARD, CHAT_SEARCH, SETTINGS } from '../common/words';
import { Avatar, Button, ChatFrame, ChatRow, ChatTitle, Composer, FaceButton, IconButton, Rail, SendButton, Sidebar, Story, StoryMessage, useWide, type Reading } from '../ui';

const FACES = ['미라', '설', '하루'];
const CHATS = ['비 오는 오후', '도서관에서', '첫 만남', '늦은 저녁'];
const ROWS = [
  { name: FACES[0]!, mine: false, time: '오후 3:12', html: storyHtml('*창밖으로 늦은 오후의 햇살이 기울어 든다.* 그녀는 찻잔을 내려놓고 고개를 들었다.\n\n"오늘은 어디까지 읽었어?"', true) },
  { name: '나', mine: true, time: '오후 3:13', html: storyHtml('"이번엔 끝까지 읽었어."', false) },
  { name: FACES[0]!, mine: false, time: '오후 3:13', html: storyHtml('"결말은 마음에 들었고?"\n\n그녀가 웃으며 책을 덮었다.', true) },
];
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
                <IconButton icon={Search} label={CHAT_SEARCH} framed onClick={nothing} />
                <IconButton icon={ACTS.create.icon} label={ACTS.create.label} framed onClick={nothing} />
              </>
            }
            places={
              <>
                <IconButton icon={MessagesSquare} label={BOARD.title} framed onClick={nothing} />
                <IconButton icon={Settings} label={SETTINGS} framed onClick={nothing} />
              </>
            }
          >
            {FACES.map((face, index) => (
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
            {CHATS.map((title, index) => (
              <ChatRow key={title} title={title} time="" typing={false} preview={FACES[0]!} sought={false} face={<Avatar face={FACES[0]!} />} current={index === 0} onClick={nothing} />
            ))}
          </Sidebar>
        </>
      )}
      <ChatFrame
        title={<ChatTitle name={FACES[0]!} description={CHATS[0]} face={<Avatar size="sm" face={FACES[0]!} />} />}
        actions={null}
        above={null}
        footer={<Composer value="" onChange={nothing} onKeyDown={nothing} placeholder="메시지" tools={null} more={null} actions={<SendButton streaming={false} disabled={false} title="" onClick={nothing} />} inputRef={input} compact={false} onOpen={nothing} />}
        dockRef={dock}
        scrollRef={scroll}
        onScroll={nothing}
        reading={reading}
        hideHeader={false}
        stage={false}
        side="right"
        compact={false}
      >
        {ROWS.map(({ name, mine, time, html }, index) => (
          <StoryMessage key={index} avatar={<Avatar size="story" face={name} tone={mine ? 'you' : 'plain'} />} name={name} time={time} mine={mine} id={String(index)}>
            <Story html={html} />
          </StoryMessage>
        ))}
      </ChatFrame>
    </>
  );
}
