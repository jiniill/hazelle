import { pinnedBy } from '../../runtime/models/assignment';
import { ModelMenu } from '../common/ModelMenu';
import { promptName } from '../common/words';
import type { OpenChat } from './useChat';

// The chat's model and the menu that picks another: in the header, or at the composer's foot where its shape stands
// an aside (useAside). Only one is mounted: the chat's other buttons open the same menu by its handle.
export function ChatModel({ chat, opens }: { chat: OpenChat; opens?: 'above-end' }) {
  const { place, route, modelMenu, actions } = chat;
  const pin = pinnedBy(place, chat.prompt);
  return <ModelMenu handle={modelMenu} place={opens} route={route} pin={pin && { name: promptName(pin.value.name), open: () => actions.side({ kind: 'prompts', id: pin.id, pane: 'model' }) }} onPick={actions.pickModel} />;
}
