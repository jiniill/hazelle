import { Bot, Brain, Gauge, ImageIcon, Languages, Shrink, Smile, type LucideIcon } from 'lucide-react';
import type { Feature } from '../../model/features';

// One mark per feature, wherever the feature is named by an icon: 설정's sidebar and the chat's buttons and menu.
export const FEATURE_ICONS: Record<Feature, LucideIcon> = { translate: Languages, illustrate: ImageIcon, memory: Brain, mascot: Smile, preread: Shrink, agents: Bot, status: Gauge };
