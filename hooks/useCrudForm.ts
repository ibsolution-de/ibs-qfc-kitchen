import { useState, useCallback, type FormEvent, type Dispatch, type SetStateAction } from 'react';

interface UseCrudFormOptions<T extends { id: string }> {
  items: T[];
  onUpdate: (items: T[]) => void;
  makeDefaults: () => Partial<T>;
  validate?: (formData: Partial<T>, editingId: string | null) => string | null;
  onAfterSave?: (item: T, isEdit: boolean) => void;
  onAfterDelete?: (item: T) => void;
}

type BuildItemFn<T extends { id: string }> = (formData: Partial<T>, editingId: string | null) => T;

interface UseCrudFormReturn<T extends { id: string }> {
  isModalOpen: boolean;
  editingId: string | null;
  formData: Partial<T>;
  setFormData: Dispatch<SetStateAction<Partial<T>>>;
  openAdd: () => void;
  openEdit: (item: T) => void;
  closeModal: () => void;
  handleSubmit: (buildItem: BuildItemFn<T>) => (e?: FormEvent) => void;
  requestDelete: (id: string) => void;
  confirmDelete: () => void;
  deleteTarget: string | null;
  cancelDelete: () => void;
  validationError: string | null;
  setValidationError: Dispatch<SetStateAction<string | null>>;
}

export function useCrudForm<T extends { id: string }>(options: UseCrudFormOptions<T>): UseCrudFormReturn<T> {
  const { items, onUpdate, makeDefaults, validate, onAfterSave, onAfterDelete } = options;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<T>>(makeDefaults);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const openAdd = useCallback(() => {
    setEditingId(null);
    setFormData(makeDefaults());
    setValidationError(null);
    setIsModalOpen(true);
  }, [makeDefaults]);

  const openEdit = useCallback((item: T) => {
    setEditingId(item.id);
    setFormData({ ...item });
    setValidationError(null);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingId(null);
    setFormData(makeDefaults());
    setValidationError(null);
  }, [makeDefaults]);

  const handleSubmit = useCallback((buildItem: BuildItemFn<T>) => (e?: FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    const error = validate ? validate(formData, editingId) : null;
    if (error) {
      setValidationError(error);
      return;
    }

    const built = buildItem(formData, editingId);

    if (editingId) {
      const updated = items.map(item => (item.id === editingId ? built : item));
      onUpdate(updated);
    } else {
      onUpdate([...items, built]);
    }

    onAfterSave?.(built, editingId !== null);

    setIsModalOpen(false);
    setEditingId(null);
    setFormData(makeDefaults());
    setValidationError(null);
  }, [formData, editingId, items, makeDefaults, onUpdate, validate, onAfterSave]);

  const requestDelete = useCallback((id: string) => {
    setDeleteTarget(id);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;

    const deleted = items.find(item => item.id === deleteTarget);
    const updated = items.filter(item => item.id !== deleteTarget);
    onUpdate(updated);

    if (deleted) {
      onAfterDelete?.(deleted);
    }

    setDeleteTarget(null);
  }, [deleteTarget, items, onUpdate, onAfterDelete]);

  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  return {
    isModalOpen,
    editingId,
    formData,
    setFormData,
    openAdd,
    openEdit,
    closeModal,
    handleSubmit,
    requestDelete,
    confirmDelete,
    deleteTarget,
    cancelDelete,
    validationError,
    setValidationError
  };
}
