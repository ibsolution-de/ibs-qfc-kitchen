import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCrudForm } from './useCrudForm';

interface TestItem {
  id: string;
  name: string;
  value: number;
}

const makeDefaults = (): Partial<TestItem> => ({ name: '', value: 0 });

const defaultItems: TestItem[] = [
  { id: '1', name: 'Alpha', value: 10 },
  { id: '2', name: 'Beta', value: 20 }
];

describe('useCrudForm', () => {
  const setup = (options: Partial<Omit<Parameters<typeof useCrudForm<TestItem>>[0], 'items' | 'onUpdate' | 'makeDefaults'> & { items?: TestItem[] }> = {}) => {
    const items = options.items ?? defaultItems;
    const onUpdate = vi.fn();
    const onAfterSave = vi.fn();
    const onAfterDelete = vi.fn();

    const { result } = renderHook(() =>
      useCrudForm<TestItem>({
        items,
        onUpdate,
        makeDefaults,
        onAfterSave,
        onAfterDelete,
        ...options
      })
    );

    return { result, items, onUpdate, onAfterSave, onAfterDelete };
  };

  it('opens the add modal with default form data', () => {
    const { result } = setup();

    expect(result.current.isModalOpen).toBe(false);

    act(() => {
      result.current.openAdd();
    });

    expect(result.current.isModalOpen).toBe(true);
    expect(result.current.editingId).toBeNull();
    expect(result.current.formData).toEqual({ name: '', value: 0 });
  });

  it('opens the edit modal and populates formData from the item', () => {
    const { result, items } = setup();

    act(() => {
      result.current.openEdit(items[1]!);
    });

    expect(result.current.isModalOpen).toBe(true);
    expect(result.current.editingId).toBe('2');
    expect(result.current.formData).toEqual(items[1]);
  });

  it('submits a new item and appends it to the list', () => {
    const { result, onUpdate, onAfterSave } = setup();

    act(() => {
      result.current.openAdd();
    });

    act(() => {
      result.current.setFormData({ name: 'Gamma', value: 30 });
    });

    act(() => {
      const submit = result.current.handleSubmit((data, id) => ({
        id: id ?? 'new-id',
        name: data.name ?? '',
        value: data.value ?? 0
      }));
      submit();
    });

    expect(onUpdate).toHaveBeenCalledWith([
      { id: '1', name: 'Alpha', value: 10 },
      { id: '2', name: 'Beta', value: 20 },
      { id: 'new-id', name: 'Gamma', value: 30 }
    ]);
    expect(onAfterSave).toHaveBeenCalledWith({ id: 'new-id', name: 'Gamma', value: 30 }, false);
    expect(result.current.isModalOpen).toBe(false);
  });

  it('replaces the correct item on edit submit', () => {
    const { result, items, onUpdate, onAfterSave } = setup();

    act(() => {
      result.current.openEdit(items[1]!);
    });

    act(() => {
      result.current.setFormData({ name: 'Beta Updated', value: 99 });
    });

    act(() => {
      const submit = result.current.handleSubmit((data, id) => ({
        id: id ?? 'should-not-happen',
        name: data.name ?? '',
        value: data.value ?? 0
      }));
      submit();
    });

    expect(onUpdate).toHaveBeenCalledWith([
      { id: '1', name: 'Alpha', value: 10 },
      { id: '2', name: 'Beta Updated', value: 99 }
    ]);
    expect(onAfterSave).toHaveBeenCalledWith({ id: '2', name: 'Beta Updated', value: 99 }, true);
  });

  it('removes the target item after confirmDelete', () => {
    const { result, items, onUpdate, onAfterDelete } = setup();

    act(() => {
      result.current.requestDelete('1');
    });

    expect(result.current.deleteTarget).toBe('1');

    act(() => {
      result.current.confirmDelete();
    });

    expect(onUpdate).toHaveBeenCalledWith([{ id: '2', name: 'Beta', value: 20 }]);
    expect(onAfterDelete).toHaveBeenCalledWith(items[0]);
    expect(result.current.deleteTarget).toBeNull();
  });

  it('cancels delete without calling onUpdate', () => {
    const { result, onUpdate } = setup();

    act(() => {
      result.current.requestDelete('1');
    });

    act(() => {
      result.current.cancelDelete();
    });

    expect(result.current.deleteTarget).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('blocks submit and surfaces a validation error when validation fails', () => {
    const { result, onUpdate } = setup({
      validate: (data) =>
        !data.name || data.name.trim() === '' ? 'Name is required' : null
    });

    act(() => {
      result.current.openAdd();
    });

    act(() => {
      const submit = result.current.handleSubmit((data) => ({
        id: 'new-id',
        name: data.name ?? '',
        value: 0
      }));
      submit();
    });

    expect(result.current.validationError).toBe('Name is required');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(result.current.isModalOpen).toBe(true);
  });
});
