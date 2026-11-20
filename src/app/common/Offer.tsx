import { answerOffer } from '../../runtime/chat/chat-context';
import { useSettings, useStore } from '../session';
import { useRoute } from '../shell/router';
import { useToast } from '../toast';
import { Button, Demo, Dialog, Row, Text } from '../ui';
import { OFFERS, offerToShow, type Offer } from './release';
import { useTutorials } from './Tutorial';

export const OFFER = { take: '써볼게요', pass: '괜찮아요', taken: (place: string) => `켰어요. ${place}에서 끌 수 있어요.`, passed: (place: string) => `${place}에서 켤 수 있어요.` };

export function OfferDialog({ offer, onAnswer }: { offer: Offer; onAnswer: (taken: boolean) => void }) {
  return (
    <Dialog
      title={offer.title}
      picture={<Demo label={offer.title} name={offer.demo} bare />}
      onClose={() => onAnswer(false)}
      actionsLayout="full"
      actions={
        <Row kind="split">
          <Button variant="secondary" onClick={() => onAnswer(false)}>
            {OFFER.pass}
          </Button>
          <Button variant="primary" onClick={() => onAnswer(true)}>
            {OFFER.take}
          </Button>
        </Row>
      }
    >
      <Text>{offer.text}</Text>
    </Dialog>
  );
}

// Asked where the offer belongs (design §6.15). Closing it any way is 괜찮아요, and an answer is the last of it on every
// device. held: something else was said this open.
export function Offers({ held }: { held: boolean }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const route = useRoute();
  const settled = useTutorials().offered.length === 0;
  const offer = held ? null : offerToShow(OFFERS, settings, route, settled);
  if (!offer) return null;
  const answer = (taken: boolean) => void answerOffer(store, offer.id, taken).then((result) => (result.ok ? toast.show(OFFER[taken ? 'taken' : 'passed'](offer.place)) : toast.failed(result)));
  return <OfferDialog offer={offer} onAnswer={answer} />;
}
