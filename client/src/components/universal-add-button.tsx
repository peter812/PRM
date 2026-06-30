import { Plus, User, AtSign, Heart, BookOpen, MessageSquare, StickyNote, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UniversalAddButtonProps {
  onAddPerson: () => void;
  onAddSocialAccount: () => void;
  onAddRelationship: () => void;
  onAddDailyNote: () => void;
  onAddInteraction: () => void;
  onAddNote: () => void;
  onAddPhoto: () => void;
}

export function UniversalAddButton({
  onAddPerson,
  onAddSocialAccount,
  onAddRelationship,
  onAddDailyNote,
  onAddInteraction,
  onAddNote,
  onAddPhoto,
}: UniversalAddButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="icon" className="h-8 w-8 rounded-full" data-testid="button-universal-add">
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-testid="dropdown-universal-add">
        <DropdownMenuItem onClick={onAddPerson} data-testid="add-menu-person">
          <User className="h-4 w-4 mr-2" />
          Person
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddSocialAccount} data-testid="add-menu-social-account">
          <AtSign className="h-4 w-4 mr-2" />
          Social Account
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddRelationship} data-testid="add-menu-relationship">
          <Heart className="h-4 w-4 mr-2" />
          Relationship
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddDailyNote} data-testid="add-menu-daily-note">
          <BookOpen className="h-4 w-4 mr-2" />
          Daily Note
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddInteraction} data-testid="add-menu-interaction">
          <MessageSquare className="h-4 w-4 mr-2" />
          Interaction
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddNote} data-testid="add-menu-note">
          <StickyNote className="h-4 w-4 mr-2" />
          Note
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddPhoto} data-testid="add-menu-photo">
          <ImageIcon className="h-4 w-4 mr-2" />
          Upload Photo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
