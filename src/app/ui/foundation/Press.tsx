import type { HTMLAttributes, KeyboardEvent, Ref } from 'react';
import { classNames } from './classNames';
import styles from './Press.module.css';

type Props = HTMLAttributes<HTMLElement> & { href?: string; disabled?: boolean; ref?: Ref<HTMLButtonElement> };

// Given where it goes (href), a press is a link, so a middle click opens it in a new tab as the browser does; its
// plain click stays its onClick's, which takes the link's default away (the router's linkTo). Otherwise a button.
// A link takes no ref and is never disabled: no press that goes somewhere holds either.
export function Press({ href, disabled, ref, className, ...props }: Props) {
  if (href === undefined) return <button ref={ref} type="button" className={className} disabled={disabled} {...props} />;
  // A link answers Space as the button it stands for, without the page scrolling; a press's own keys come first.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    props.onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) event.currentTarget.click();
  };
  // A link drags as its address unless told not to; a card that drags carries its own (cardDrag).
  return <a href={href} className={classNames(styles.link, className)} {...props} onKeyDown={onKeyDown} draggable={props.draggable ?? false} />;
}
