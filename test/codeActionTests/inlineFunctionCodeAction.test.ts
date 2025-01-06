import { testCodeAction } from "./codeActionTestBase";

describe("inline function code action", () => {
  it("should inline function and compute parameters", async () => {
    const source = `
--@ Test.elm
module Test exposing (..)

type T a =
    T a

val2 = 
    0

foo val str =
    case val of
        Just { field1, field2, field3 } ->
            newFunction field1 val field2
            --^

        Nothing ->
            str + val2


newFunction : Maybe { a | prop1 : number, prop2 : number } -> number -> T number -> Maybe number
newFunction f1 val (T f2) =
    case f1 of
        Just { prop1, prop2 } ->
            prop1 + prop2 + val + f2

        Nothing ->
            f2 + val2
`;

    const expectedSource = `
--@ Test.elm
module Test exposing (..)

type T a =
    T a

val2 = 
    0

foo val str =
    case val of
        Just { field1, field2, field3 } ->
            let
                (T f2) = field2
            in
            case field1 of
                Just { prop1, prop2 } ->
                    prop1 + prop2 + val + f2

                Nothing ->
                    f2 + val2

        Nothing ->
            str + val2




`;

    await testCodeAction(
      source,
      [{ title: "Inline function and remove definition" }],
      expectedSource,
    );
  });

  it("should inline all calls", async () => {
    const source = `
--@ Test.elm
module Test exposing (..)

foo val str =
    newFunction val
        --^

bar val str =
    newFunction val

newFunction : number -> number
newFunction val =
    val + val
`;

    const expectedSource = `
--@ Test.elm
module Test exposing (..)

foo val str =
    val + val

bar val str =
    val + val

newFunction : number -> number
newFunction val =
    val + val
`;

    await testCodeAction(
      source,
      [{ title: "Inline all calls of this function" }],
      expectedSource,
    );
  });

  it("should inline a single call", async () => {
    const source = `
--@ Test.elm
module Test exposing (..)

foo val str =
    newFunction val
        --^

bar val str =
    newFunction val

newFunction : number -> number
newFunction val =
    val + val
`;

    const expectedSource = `
--@ Test.elm
module Test exposing (..)

foo val str =
    val + val

bar val str =
    newFunction val

newFunction : number -> number
newFunction val =
    val + val
`;

    await testCodeAction(
      source,
      [{ title: "Inline this call" }],
      expectedSource,
    );
  });
});
